# Server set-up with Ansible

Step 3.3 · Owner: Sonam. Step 1.9 swapped k3s for docker compose and ufw for iptables.

`site.yml` turns a fresh Ubuntu 22.04 or 24.04 server (our Azure x64 VM; an Oracle Cloud ARM VM works too) into a Peerlytics server:

| Role | What it does |
|---|---|
| `base` | Installs package updates and turns on automatic security updates. Sets the time zone to Asia/Thimphu |
| `users` | Creates the `deploy` user. It has no password and logs in only with your SSH key. It can use `sudo` |
| `ssh` | Turns off password login, root login and every user except `deploy`. It runs `sshd -t` before restarting SSH, and refuses to run if `deploy` has no key |
| `fail2ban` | Bans an address for an hour after 5 failed SSH logins in 10 minutes |
| `firewall` | iptables accepts 22, 80 and 443, ahead of the REJECT rule that Oracle's Ubuntu image ends INPUT with (Azure's has none), both now and in `/etc/iptables/rules.v4` for after a reboot |
| `docker` | Docker Engine and the compose plugin, from Docker's apt repository. Container logs rotate at 10 MB |
| `compose_host` | `/opt/peerlytics` and its `infra/` and `edge/upstreams/` folders, owned by `deploy`, and the `edge` Docker network |

Every task checks before it changes anything, so running the playbook again is safe. Step 5.2 relies on this when it re-runs the playbook on a fresh server.

## What you need

- A machine with Ansible: Linux, macOS or WSL. Ansible doesn't run on Windows itself.
- An SSH key pair. Only the **public** key (`.pub`) is used, and it's read from your machine, never from git.
- The server's address in `inventory.ini`. Copy `inventory.example.ini`; `inventory.ini` is git-ignored.
- On Azure: inbound rules for TCP 22, 80 and 443 in the VM's network security group.
- On Oracle Cloud: ingress rules for TCP 80 and 443 in the subnet's security list. The VCN filters before the server's own iptables does.

## First run

```bash
cd infra/ansible
ansible-galaxy collection install -r requirements.yml -p collections
cp inventory.example.ini inventory.ini        # add: vps1 ansible_host=<server address>
# First time: as the provider's initial user (azureuser on Azure, ubuntu on Oracle Cloud)
ansible-playbook site.yml -u azureuser -e deploy_ssh_public_key_file=~/.ssh/id_ed25519.pub
```

The SSH changes take effect at the end of the run. From then on, connect as `deploy`:

```bash
ansible-playbook site.yml -u deploy -e deploy_ssh_public_key_file=~/.ssh/id_ed25519.pub
```

A second run should end with `changed=0`, or close to it: only package updates can change.

## Check the result

From your machine:

```bash
ssh deploy@<server>                             # works with your key
ssh root@<server>                               # Permission denied
ssh -o PubkeyAuthentication=no deploy@<server>  # Permission denied (no passwords)
nmap -Pn -p 1-10000 <server>                    # only 22, 80, 443 open
```

On the server:

```bash
sudo iptables -S INPUT | grep -E 'dport (80|443)'
sudo fail2ban-client status sshd
docker network ls | grep edge
ls -ld /opt/peerlytics /opt/peerlytics/edge/upstreams
```

## Proving it on a fresh server (step 5.2)

The playbook is only proven once it has built a server from nothing. Do this before go-live:

1. Create a new Ubuntu 24.04 VPS with only your SSH key, and put its address in `inventory.ini`.
2. Run the first-run command above, then run it again as `deploy`. The second run must end with `changed=0`, or only package updates.
3. Run every command in "Check the result".
4. Write the env files and deploy the app as `docs/deploy.md` describes (run the CD workflows, or `infra/scripts/deploy.sh` by hand).
5. Record the run below with the real numbers.

| Date | Ubuntu | First run (min) | Second run `changed=` | SSH root / password refused | Open ports | edge network | Who |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Notes

- Only Caddy (`infra/edge`) publishes ports, and only 80 and 443. The app containers publish none; PostgreSQL is reachable only on each project's private network.
- Docker adds its own iptables chains when it starts. The playbook never runs `netfilter-persistent save`, so Docker's rules aren't frozen into `rules.v4`.
- No secrets are stored here. The env files under `/opt/peerlytics` are written by hand (`docs/deploy.md`).
- Check the playbook with `ansible-playbook site.yml --syntax-check` and `ansible-lint`. Only a real server can show that it works end to end.
