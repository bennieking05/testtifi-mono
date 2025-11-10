-- Replace hyphenated brand variants in Email.subject and Email.body
-- Run in MySQL with the correct database selected

-- Subject
UPDATE `Email`
SET `subject` = REPLACE(REPLACE(REPLACE(REPLACE(`subject`, 'Testifi‑AI', 'Testifi AI'), 'Testifi-AI', 'Testifi AI'), 'Testifi–AI', 'Testifi AI'), 'Testifi—AI', 'Testifi AI');

-- Body
UPDATE `Email`
SET `body` = REPLACE(REPLACE(REPLACE(REPLACE(`body`, 'Testifi‑AI', 'Testifi AI'), 'Testifi-AI', 'Testifi AI'), 'Testifi–AI', 'Testifi AI'), 'Testifi—AI', 'Testifi AI');









