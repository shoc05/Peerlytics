// Step 6.7: college subscriptions with manual payments (docs/phase6-spec.md section 3.2,
// docs/billing.md). No seed rows: plans, payment methods and payment settings are entered by a
// superAdmin. Colleges are the only buyers (D1), so every request and subscription has a college.
//
// One change from the spec: seats belong to the college (seat_assignments.college_id), not to a
// single subscription row. A renewal is a new subscription row, so seats stay where they are and
// the limit is the seat count of whichever subscription is in effect.

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE plans (
      id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name                 text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
      price_nu             numeric(12,2) NOT NULL CHECK (price_nu > 0),
      duration_days        integer NOT NULL CHECK (duration_days BETWEEN 1 AND 1100),
      seats                integer NOT NULL CHECK (seats BETWEEN 1 AND 100000),
      max_courses          integer CHECK (max_courses BETWEEN 1 AND 1000),
      monthly_ai_analyses  integer CHECK (monthly_ai_analyses >= 0),
      is_active            boolean NOT NULL DEFAULT true,
      manual_only          boolean NOT NULL DEFAULT false,
      created_by           text REFERENCES users(id) ON DELETE SET NULL,
      created_at           timestamptz NOT NULL DEFAULT now(),
      updated_at           timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX plans_name_key ON plans (lower(name));

    CREATE TABLE payment_methods (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
      is_active   boolean NOT NULL DEFAULT true,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX payment_methods_name_key ON payment_methods (lower(name));

    -- At most one row. Until a superAdmin saves it, the app uses the defaults (grace_days 7).
    CREATE TABLE payment_settings (
      id                    smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      account_name          text CHECK (char_length(account_name) <= 200),
      account_number        text CHECK (char_length(account_number) <= 60),
      bank                  text CHECK (char_length(bank) <= 200),
      qr_image_path         text CHECK (char_length(qr_image_path) <= 500),
      verification_message  text CHECK (char_length(verification_message) <= 2000),
      refund_policy         text CHECK (char_length(refund_policy) <= 4000),
      grace_days            integer NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 60),
      updated_by            text REFERENCES users(id) ON DELETE SET NULL,
      updated_at            timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE payment_requests (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      payer_id           text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      college_id         uuid NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
      plan_id            uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
      reference_code     text NOT NULL UNIQUE CHECK (reference_code ~ '^PL-[A-HJKMNP-Z2-9]{6}$'),
      amount_nu          numeric(12,2) NOT NULL CHECK (amount_nu > 0),
      payment_method_id  uuid NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
      journal_number     text NOT NULL CHECK (journal_number ~ '^[A-Z0-9-]{4,40}$'),
      paid_on            date NOT NULL,
      status             text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
      reject_reason      text CHECK (char_length(reject_reason) BETWEEN 5 AND 500),
      reviewed_by        text REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at        timestamptz,
      created_at         timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT payment_requests_reason_only_when_rejected CHECK ((status = 'rejected') = (reject_reason IS NOT NULL)),
      CONSTRAINT payment_requests_pending_not_reviewed CHECK (status <> 'pending' OR reviewed_at IS NULL)
    );
    -- D8: a journal number can be used again after rejection or cancellation, never while it is
    -- pending or approved. The database enforces it, so two requests at once can't both get in.
    CREATE UNIQUE INDEX payment_requests_journal_key
      ON payment_requests (payment_method_id, journal_number)
      WHERE status IN ('pending', 'approved');
    CREATE INDEX payment_requests_status_idx ON payment_requests (status, created_at);
    CREATE INDEX payment_requests_college_idx ON payment_requests (college_id, created_at DESC);
    CREATE INDEX payment_requests_payer_idx ON payment_requests (payer_id, status);
    CREATE INDEX payment_requests_plan_idx ON payment_requests (plan_id);
    CREATE INDEX payment_requests_method_idx ON payment_requests (payment_method_id);
    CREATE INDEX payment_requests_reviewed_by_idx ON payment_requests (reviewed_by);

    -- Status (active, grace, read_only, revoked) is worked out from the dates and revoked_at,
    -- so no job can leave it wrong.
    CREATE TABLE subscriptions (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      college_id          uuid NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
      plan_id             uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
      payment_request_id  uuid UNIQUE REFERENCES payment_requests(id) ON DELETE RESTRICT,
      starts_at           timestamptz NOT NULL,
      ends_at             timestamptz NOT NULL,
      grant_type          text NOT NULL CHECK (grant_type IN ('paid', 'manual')),
      note                text CHECK (char_length(note) <= 500),
      revoked_at          timestamptz,
      revoke_reason       text CHECK (char_length(revoke_reason) BETWEEN 5 AND 500),
      created_by          text REFERENCES users(id) ON DELETE SET NULL,
      created_at          timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT subscriptions_period_check CHECK (ends_at > starts_at),
      CONSTRAINT subscriptions_paid_has_request CHECK ((grant_type = 'paid') = (payment_request_id IS NOT NULL)),
      CONSTRAINT subscriptions_revoke_pair CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
    );
    CREATE INDEX subscriptions_college_idx ON subscriptions (college_id, ends_at DESC);
    CREATE INDEX subscriptions_plan_idx ON subscriptions (plan_id);
    CREATE INDEX subscriptions_created_by_idx ON subscriptions (created_by);

    CREATE TABLE seat_assignments (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      college_id   uuid NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
      lecturer_id  text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_by  text REFERENCES users(id) ON DELETE SET NULL,
      assigned_at  timestamptz NOT NULL DEFAULT now(),
      removed_at   timestamptz,
      removed_by   text REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT seat_assignments_removed_after CHECK (removed_at IS NULL OR removed_at >= assigned_at)
    );
    -- One open seat per lecturer.
    CREATE UNIQUE INDEX seat_assignments_one_open_seat ON seat_assignments (lecturer_id) WHERE removed_at IS NULL;
    CREATE INDEX seat_assignments_college_idx ON seat_assignments (college_id) WHERE removed_at IS NULL;
    CREATE INDEX seat_assignments_lecturer_idx ON seat_assignments (lecturer_id, removed_at DESC);
    CREATE INDEX seat_assignments_assigned_by_idx ON seat_assignments (assigned_by);
    CREATE INDEX seat_assignments_removed_by_idx ON seat_assignments (removed_by);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE seat_assignments;
    DROP TABLE subscriptions;
    DROP TABLE payment_requests;
    DROP TABLE payment_settings;
    DROP TABLE payment_methods;
    DROP TABLE plans;
  `);
};
