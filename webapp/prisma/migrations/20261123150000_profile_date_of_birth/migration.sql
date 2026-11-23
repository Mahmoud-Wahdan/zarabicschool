ALTER TABLE users ADD COLUMN date_of_birth date;

-- Only copy a date belonging to the approved student, never a linked guardian.
WITH source AS (
  SELECT approved_user_id AS id, academy_id, details->>'date_of_birth' AS dob
  FROM applications WHERE application_type = 'STUDENT' AND status = 'APPROVED'
), dates AS (
  SELECT id, academy_id, dob, CASE WHEN dob ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
    AND left(dob, 4) <> '0000'
    THEN make_date(left(dob, 4)::int, substring(dob, 6, 2)::int, 1) + (right(dob, 2)::int - 1)
    END AS birth FROM source
)
UPDATE users u SET date_of_birth = d.birth FROM dates d
WHERE u.id = d.id AND u.academy_id = d.academy_id AND u.role = 'STUDENT'
  AND to_char(d.birth, 'YYYY-MM-DD') = d.dob AND d.birth <= CURRENT_DATE;

UPDATE students s
SET is_adult = EXTRACT(YEAR FROM age(CURRENT_DATE, u.date_of_birth)) >= 18
FROM users u
WHERE s.user_id = u.id
  AND s.academy_id = u.academy_id
  AND u.role = 'STUDENT'
  AND u.date_of_birth IS NOT NULL;
