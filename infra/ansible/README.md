# Server set-up with Ansible

Step 3.3 · Owner: Sonam

`site.yml` turns a fresh Ubuntu 22.04 or 24.04 VPS into a Peerlytics server:

| Role | What it does |
|---|---|
| `base` | Installs package updates and turns on automatic security updates. Sets the time zone to Asia/Thimphu |
| `users` | Creates the `deploy` user. It has no password and logs in only with your SSH key. It can use `sudo` |
| `ssh` | Turns off password login, root login and every user except `deploy`. It runs `sshd -t` before restarting SSH, and refuses to run if `deploy` has no key |
| `fail2ban` | Bans an address for an hour after 5 failed SSH logins in 10 minutes |
| `firewall` | ufw blocks everything incoming except 22 (rate-limited), 80 and 443. It also allows k3s's internal pod and service networks |
| `docker` | Docker Engine and the compose plugin, from Docker's apt repository |
| `k3s` | k3s at the pinned `k3s_version`, with Traefik. Creates the `staging`, `production` and `monitoring` namespaces |

Every task checks before it changes anything, so running the playbook again is safe. Step 5.2 relies on this when it re-runs the playbook on a fresh server.

## What you need

- A machine with Ansible: Linux, macOS or WSL. Ansible doesn't run on Windows itself.
- An SSH key pair. Only the **public** key (`.pub`) is used, and it's read from your machine, never from git.
- The server's address in `inventory.ini`. Copy `inventory.example.ini`; `inventory.ini` is git-ignored.

## First run

```bash
cd infra/ansible
ansible-galaxy collection install -r requirements.yml -p collections
cp inventory.example.ini inventory.ini        # add: vps1 ansible_host=<server address>
# First time: as the provider's initial user (root or ubuntu)
ansible-playbook site.yml -u root -e deploy_ssh_public_key_file=~/.ssh/id_ed25519.pub
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
sudo ufw status verbose
sudo fail2ban-client status sshd
kubectl get nodes
kubectl get namespaces    # staging, production, monitoring
```

## Notes

- Docker's published ports (`docker run -p`) bypass ufw. The apps run in k3s, not plain Docker; use Docker only to build images.
- No secrets are stored here. App secrets go into Kubernetes Secrets (step 4.1), created with `kubectl` and never committed.
- CI runs `ansible-playbook --syntax-check` and `ansible-lint` on every PR (the `ansible (syntax, lint)` job). Only a real server can show that the playbook works end to end.
