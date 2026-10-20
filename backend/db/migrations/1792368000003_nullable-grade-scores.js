// Step 2.8: Writing and Tasks can be unmeasurable (no analysis available; a group that made no
// tasks). Their score is then NULL, its weight is shared among the other scores, and the
// grade's explanation says so. Time and Edits are always measured and stay NOT NULL.

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE grades ALTER COLUMN writing_score DROP NOT NULL;
    ALTER TABLE grades ALTER COLUMN tasks_score DROP NOT NULL;
  `);
};

export const down = (pgm) => {
  // Put back the old rule; rows with a NULL score would block it, so they become 0 first.
  pgm.sql(`
    UPDATE grades SET writing_score = 0 WHERE writing_score IS NULL;
    UPDATE grades SET tasks_score = 0 WHERE tasks_score IS NULL;
    ALTER TABLE grades ALTER COLUMN writing_score SET NOT NULL;
    ALTER TABLE grades ALTER COLUMN tasks_score SET NOT NULL;
  `);
};
