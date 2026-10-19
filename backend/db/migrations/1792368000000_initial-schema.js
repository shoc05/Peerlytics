// Every table in docs/db-schema.md (step 1.5). Plain SQL so it reads the same as the doc:
// if one changes, change the other in the same PR. gen_random_uuid() is built into
// PostgreSQL 13+, so no extension is needed.

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE colleges (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200),
      slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE licences (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      college_id             uuid NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
      plan                   text NOT NULL CHECK (plan IN ('trial', 'standard')),
      seats                  integer NOT NULL CHECK (seats > 0),
      monthly_ai_budget_usd  numeric(10,2) NOT NULL DEFAULT 0 CHECK (monthly_ai_budget_usd >= 0),
      starts_on              date NOT NULL,
      ends_on                date CHECK (ends_on IS NULL OR ends_on > starts_on),
      created_at             timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX licences_college_starts_idx ON licences (college_id, starts_on DESC);

    CREATE TABLE college_domains (
      domain      text PRIMARY KEY CHECK (domain = lower(domain)),
      college_id  uuid NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX college_domains_college_idx ON college_domains (college_id);

    CREATE TABLE users (
      id            text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 128),
      college_id    uuid REFERENCES colleges(id) ON DELETE SET NULL,
      email         text,
      display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
      role          text CHECK (role IN ('superAdmin', 'collegeAdmin', 'lecturer', 'student')),
      deleted_at    timestamptz,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email)) WHERE email IS NOT NULL;
    CREATE INDEX users_college_idx ON users (college_id);

    CREATE TABLE courses (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      college_id         uuid REFERENCES colleges(id) ON DELETE RESTRICT,
      code               text NOT NULL CHECK (char_length(code) BETWEEN 2 AND 20),
      title              text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
      description        text CHECK (char_length(description) <= 5000),
      term               text CHECK (char_length(term) <= 40),
      join_code          text NOT NULL UNIQUE CHECK (join_code ~ '^[A-HJKMNP-Z2-9]{8}$'),
      join_code_enabled  boolean NOT NULL DEFAULT true,
      owner_id           text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      archived_at        timestamptz,
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX courses_college_idx ON courses (college_id);
    CREATE INDEX courses_owner_idx ON courses (owner_id);

    CREATE TABLE enrolments (
      course_id    uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_role  text NOT NULL CHECK (course_role IN ('lecturer', 'student')),
      joined_via   text NOT NULL CHECK (joined_via IN ('owner', 'code', 'invite')),
      joined_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (course_id, user_id)
    );
    CREATE INDEX enrolments_user_idx ON enrolments (user_id);

    CREATE TABLE announcements (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      author_id   text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
      body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
      pinned      boolean NOT NULL DEFAULT false,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX announcements_course_idx ON announcements (course_id, pinned DESC, created_at DESC);
    CREATE INDEX announcements_author_idx ON announcements (author_id);

    CREATE TABLE assignments (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      course_id         uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title             text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
      brief             text NOT NULL CHECK (char_length(brief) BETWEEN 1 AND 20000),
      deadline          timestamptz NOT NULL,
      weight_time       numeric(3,2) NOT NULL DEFAULT 0.25 CHECK (weight_time BETWEEN 0 AND 1),
      weight_edits      numeric(3,2) NOT NULL DEFAULT 0.25 CHECK (weight_edits BETWEEN 0 AND 1),
      weight_writing    numeric(3,2) NOT NULL DEFAULT 0.25 CHECK (weight_writing BETWEEN 0 AND 1),
      weight_tasks      numeric(3,2) NOT NULL DEFAULT 0.25 CHECK (weight_tasks BETWEEN 0 AND 1),
      time_cap_minutes  integer CHECK (time_cap_minutes > 0),
      group_size        integer CHECK (group_size BETWEEN 1 AND 20),
      created_by        text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT assignments_weights_sum_check
        CHECK (weight_time + weight_edits + weight_writing + weight_tasks = 1.00)
    );
    CREATE INDEX assignments_course_deadline_idx ON assignments (course_id, deadline);
    CREATE INDEX assignments_created_by_idx ON assignments (created_by);

    CREATE TABLE workspaces (
      id             text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,128}$'),
      assignment_id  uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
      created_via    text NOT NULL CHECK (created_via IN ('manual', 'auto')),
      status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'locked')),
      created_by     text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT workspaces_assignment_name_key UNIQUE (assignment_id, name),
      -- Target of workspace_members' two-column foreign key.
      CONSTRAINT workspaces_id_assignment_key UNIQUE (id, assignment_id)
    );
    CREATE INDEX workspaces_created_by_idx ON workspaces (created_by);

    CREATE TABLE workspace_members (
      workspace_id   text NOT NULL,
      user_id        text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assignment_id  uuid NOT NULL,
      joined_at      timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, user_id),
      FOREIGN KEY (workspace_id, assignment_id) REFERENCES workspaces (id, assignment_id) ON DELETE CASCADE,
      -- A student is in at most one group per assignment.
      CONSTRAINT workspace_members_one_group_per_assignment UNIQUE (assignment_id, user_id)
    );
    CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);

    CREATE TABLE group_extensions (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id       text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      deadline           timestamptz NOT NULL,
      previous_deadline  timestamptz,
      reason             text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
      granted_by         text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at         timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX group_extensions_workspace_idx ON group_extensions (workspace_id, created_at DESC);
    CREATE INDEX group_extensions_granted_by_idx ON group_extensions (granted_by);

    CREATE TABLE tasks (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
      owner_id      text REFERENCES users(id) ON DELETE SET NULL,
      tab_id        text CHECK (char_length(tab_id) BETWEEN 1 AND 64),
      due_at        timestamptz,
      done_at       timestamptz,
      done_by       text REFERENCES users(id) ON DELETE SET NULL,
      created_by    text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT tasks_done_pair_check CHECK ((done_at IS NULL) = (done_by IS NULL))
    );
    CREATE INDEX tasks_workspace_idx ON tasks (workspace_id);
    CREATE INDEX tasks_owner_idx ON tasks (owner_id);
    CREATE INDEX tasks_done_by_idx ON tasks (done_by);
    CREATE INDEX tasks_created_by_idx ON tasks (created_by);

    CREATE TABLE submissions (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    text NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
      submitted_by    text REFERENCES users(id) ON DELETE SET NULL,
      trigger         text NOT NULL CHECK (trigger IN ('manual', 'deadline')),
      word_count      integer NOT NULL CHECK (word_count >= 0),
      tabs            jsonb,
      author_metrics  jsonb NOT NULL,
      document_ref    text NOT NULL,
      submitted_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX submissions_submitted_by_idx ON submissions (submitted_by);

    CREATE TABLE analysis_results (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      submission_id      uuid NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
      provider           text NOT NULL CHECK (provider IN ('openai', 'legacy')),
      model              text,
      status             text NOT NULL CHECK (status IN ('completed', 'partial', 'unavailable')),
      fallback_reason    text CHECK (fallback_reason IN ('openai_error', 'openai_timeout', 'budget_reached', 'flag_legacy')),
      ai_likelihood      smallint CHECK (ai_likelihood BETWEEN 0 AND 100),
      flagged_sentences  jsonb NOT NULL DEFAULT '[]',
      writing_quality    numeric(4,2) CHECK (writing_quality BETWEEN 0 AND 10),
      writing_feedback   jsonb NOT NULL DEFAULT '{}',
      difficulty         smallint CHECK (difficulty BETWEEN 1 AND 3),
      grade_explanation  text CHECK (char_length(grade_explanation) <= 4000),
      result             jsonb NOT NULL,
      schema_version     smallint NOT NULL DEFAULT 1,
      created_at         timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX analysis_results_submission_idx ON analysis_results (submission_id, created_at DESC);

    CREATE TABLE grades (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id        text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id             text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      analysis_result_id  uuid REFERENCES analysis_results(id) ON DELETE RESTRICT,
      time_score          numeric(4,2) NOT NULL CHECK (time_score BETWEEN 0 AND 10),
      edits_score         numeric(4,2) NOT NULL CHECK (edits_score BETWEEN 0 AND 10),
      writing_score       numeric(4,2) NOT NULL CHECK (writing_score BETWEEN 0 AND 10),
      tasks_score         numeric(4,2) NOT NULL CHECK (tasks_score BETWEEN 0 AND 10),
      weights             jsonb NOT NULL,
      deductions          jsonb NOT NULL DEFAULT '[]',
      suggested           numeric(4,2) NOT NULL CHECK (suggested BETWEEN 0 AND 10),
      explanation         text NOT NULL,
      computed_at         timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT grades_workspace_user_key UNIQUE (workspace_id, user_id)
    );
    CREATE INDEX grades_user_idx ON grades (user_id);
    CREATE INDEX grades_analysis_result_idx ON grades (analysis_result_id);

    CREATE TABLE overrides (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      grade_id        uuid NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
      lecturer_id     text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      previous_grade  numeric(4,2) NOT NULL CHECK (previous_grade BETWEEN 0 AND 10),
      new_grade       numeric(4,2) NOT NULL CHECK (new_grade BETWEEN 0 AND 10),
      reason          text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
      created_at      timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX overrides_grade_idx ON overrides (grade_id, created_at DESC);
    CREATE INDEX overrides_lecturer_idx ON overrides (lecturer_id);

    CREATE TABLE peer_evaluations (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      rater_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ratee_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment       text CHECK (char_length(comment) <= 500),
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT peer_evaluations_once_key UNIQUE (workspace_id, rater_id, ratee_id),
      CONSTRAINT peer_evaluations_not_self_check CHECK (rater_id <> ratee_id)
    );
    CREATE INDEX peer_evaluations_rater_idx ON peer_evaluations (rater_id);
    CREATE INDEX peer_evaluations_ratee_idx ON peer_evaluations (ratee_id);

    CREATE TABLE usage (
      id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      college_id         uuid REFERENCES colleges(id) ON DELETE SET NULL,
      course_id          uuid REFERENCES courses(id) ON DELETE SET NULL,
      submission_id      uuid REFERENCES submissions(id) ON DELETE SET NULL,
      provider           text NOT NULL CHECK (provider IN ('openai', 'huggingface', 'vwt')),
      model              text,
      outcome            text NOT NULL CHECK (outcome IN ('ok', 'error', 'timeout', 'invalid_output')),
      prompt_tokens      integer NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
      completion_tokens  integer NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
      cost_usd           numeric(10,6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
      latency_ms         integer CHECK (latency_ms >= 0),
      created_at         timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX usage_college_created_idx ON usage (college_id, created_at);
    CREATE INDEX usage_course_idx ON usage (course_id);
    CREATE INDEX usage_submission_idx ON usage (submission_id);

    CREATE TABLE audit_log (
      id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      actor_id     text REFERENCES users(id) ON DELETE SET NULL,
      action       text NOT NULL CHECK (action ~ '^[a-z_]+(\\.[a-z_]+)+$'),
      target_type  text NOT NULL,
      target_id    text NOT NULL,
      details      jsonb NOT NULL DEFAULT '{}',
      created_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id, created_at DESC);
    CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);
  `);
};

export const down = (pgm) => {
  // Reverse order of creation, so no table is dropped while another still points at it.
  pgm.sql(`
    DROP TABLE audit_log;
    DROP TABLE usage;
    DROP TABLE peer_evaluations;
    DROP TABLE overrides;
    DROP TABLE grades;
    DROP TABLE analysis_results;
    DROP TABLE submissions;
    DROP TABLE tasks;
    DROP TABLE group_extensions;
    DROP TABLE workspace_members;
    DROP TABLE workspaces;
    DROP TABLE assignments;
    DROP TABLE announcements;
    DROP TABLE enrolments;
    DROP TABLE courses;
    DROP TABLE users;
    DROP TABLE college_domains;
    DROP TABLE licences;
    DROP TABLE colleges;
  `);
};
