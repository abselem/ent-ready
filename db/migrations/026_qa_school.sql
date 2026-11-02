-- A deliberately bounded QA workspace, not general tenant migration.
ALTER TABLE groups ADD COLUMN organization_id INT REFERENCES organizations(id);
CREATE TABLE qa_workspace_registry (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    organization_id INT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    default_group_id INT NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
    teacher_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE qa_workspace_accounts (
    user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    organization_id INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    default_group_id INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE
);

CREATE FUNCTION qa_resource_access(actor INT, author INT, resource_group INT) RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
 WITH scopes AS (
   SELECT (SELECT organization_id FROM qa_workspace_accounts WHERE user_id=actor) AS actor_org,
          (SELECT organization_id FROM qa_workspace_accounts WHERE user_id=author) AS author_org,
          (SELECT organization_id FROM groups WHERE id=resource_group) AS group_org
 ), target AS (SELECT *, COALESCE(author_org,group_org) AS target_org FROM scopes)
 SELECT CASE
 WHEN author_org IS NOT NULL AND group_org IS NOT NULL AND author_org<>group_org THEN FALSE
 WHEN author_org IS NOT NULL AND resource_group IS NOT NULL AND resource_group IS DISTINCT FROM (SELECT default_group_id FROM qa_workspace_accounts WHERE user_id=author) THEN FALSE
 WHEN target_org IS NULL THEN actor_org IS NULL
 ELSE (actor_org IS NULL OR actor_org=target_org) AND EXISTS(
   SELECT 1 FROM organization_members m WHERE m.organization_id=target_org AND m.user_id=actor AND m.status='active'
   AND m.role IN('owner','admin','teacher','student')
   AND (actor_org IS NULL OR EXISTS(SELECT 1 FROM qa_workspace_registry r WHERE r.organization_id=m.organization_id AND
      ((r.teacher_user_id=actor AND m.role IN('owner','admin','teacher')) OR (r.student_user_id=actor AND m.role='student')))))
 END FROM target
$$;

CREATE FUNCTION provision_qa_school() RETURNS BOOLEAN LANGUAGE plpgsql AS $$
#variable_conflict use_variable
DECLARE teacher_id INT; student_id INT; teacher_role INT; student_role INT;
        org_id INT; grp_id INT; selected_tests INT[]; selected_lessons INT[]; question_ids INT[];
        existing qa_workspace_registry%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(20261101,26);
 SELECT id,role_id INTO teacher_id,teacher_role FROM users WHERE email='qa.teacher.20261101@example.test';
 SELECT id,role_id INTO student_id,student_role FROM users WHERE email='qa.student.20261101@example.test';
 IF teacher_id IS NULL OR student_id IS NULL THEN RETURN FALSE; END IF;
 IF NOT EXISTS(SELECT 1 FROM roles WHERE id=teacher_role AND code='teacher') OR
    NOT EXISTS(SELECT 1 FROM roles WHERE id=student_role AND code='student') THEN
   RAISE EXCEPTION 'QA identity role conflict';
 END IF;
 SELECT * INTO existing FROM qa_workspace_registry WHERE singleton;
 IF FOUND THEN
   IF existing.teacher_user_id<>teacher_id OR existing.student_user_id<>student_id OR
      NOT EXISTS(SELECT 1 FROM groups WHERE id=existing.default_group_id AND teacher_id=existing.teacher_user_id AND organization_id=existing.organization_id) OR
      (SELECT count(*) FROM qa_workspace_accounts WHERE organization_id=existing.organization_id AND default_group_id=existing.default_group_id AND user_id IN(teacher_id,student_id))<>2 THEN
     RAISE EXCEPTION 'QA registry conflict';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM organization_members WHERE organization_id=existing.organization_id AND user_id=teacher_id AND role IN('owner','admin','teacher')) OR
      NOT EXISTS(SELECT 1 FROM organization_members WHERE organization_id=existing.organization_id AND user_id=student_id AND role='student') THEN
     RAISE EXCEPTION 'QA membership role conflict';
   END IF;
   RETURN TRUE; -- Never reactivate a revoked membership during a redeploy.
 END IF;
 IF EXISTS(SELECT 1 FROM qa_workspace_accounts WHERE user_id IN(teacher_id,student_id)) THEN RAISE EXCEPTION 'QA binding conflict'; END IF;
 SELECT g.id INTO grp_id FROM groups g WHERE g.teacher_id=teacher_id AND g.name='QA 01.11';
 IF (SELECT count(*) FROM groups g WHERE g.teacher_id=teacher_id AND g.name='QA 01.11')>1 THEN RAISE EXCEPTION 'QA group conflict'; END IF;
 IF EXISTS(SELECT 1 FROM groups g WHERE g.id=grp_id AND g.organization_id IS NOT NULL) THEN RAISE EXCEPTION 'QA group organization conflict'; END IF;
 SELECT COALESCE(array_agg(t.id),'{}') INTO selected_tests FROM tests t WHERE t.created_by=teacher_id AND t.title LIKE 'QA%';
 SELECT COALESCE(array_agg(l.id),'{}') INTO selected_lessons FROM lessons l WHERE l.created_by=teacher_id AND l.title LIKE 'QA%';
 SELECT COALESCE(array_agg(DISTINCT id),'{}') INTO question_ids FROM (
   SELECT q.id FROM questions q WHERE q.test_id=ANY(selected_tests)
   UNION SELECT tq.question_id FROM test_questions tq WHERE tq.test_id=ANY(selected_tests)
 ) q;
 IF EXISTS(SELECT 1 FROM lessons l WHERE l.group_id=grp_id AND NOT(l.id=ANY(selected_lessons))) OR
    EXISTS(SELECT 1 FROM tests t WHERE t.group_id=grp_id AND NOT(t.id=ANY(selected_tests))) OR
    EXISTS(SELECT 1 FROM questions q WHERE q.id=ANY(question_ids) AND (q.owner_id IS DISTINCT FROM teacher_id OR (q.test_id IS NOT NULL AND NOT(q.test_id=ANY(selected_tests))))) OR
    EXISTS(SELECT 1 FROM test_questions tq WHERE tq.question_id=ANY(question_ids) AND NOT(tq.test_id=ANY(selected_tests))) OR
    EXISTS(SELECT 1 FROM question_contexts qc JOIN questions q ON q.context_id=qc.id WHERE q.id=ANY(question_ids) AND qc.created_by IS DISTINCT FROM teacher_id) OR
    EXISTS(SELECT 1 FROM questions q WHERE q.context_id IN(SELECT context_id FROM questions WHERE id=ANY(question_ids)) AND NOT(q.id=ANY(question_ids))) OR
    EXISTS(SELECT 1 FROM ent_attempt_questions WHERE question_id=ANY(question_ids)) OR
    EXISTS(SELECT 1 FROM test_attempts a WHERE a.test_id=ANY(selected_tests) AND a.user_id NOT IN(teacher_id,student_id) AND NOT EXISTS(SELECT 1 FROM user_groups ug WHERE ug.group_id=grp_id AND ug.user_id=a.user_id)) OR
    EXISTS(SELECT 1 FROM lesson_views v WHERE v.lesson_id=ANY(selected_lessons) AND v.user_id NOT IN(teacher_id,student_id) AND NOT EXISTS(SELECT 1 FROM user_groups ug WHERE ug.group_id=grp_id AND ug.user_id=v.user_id)) OR
    EXISTS(SELECT 1 FROM lesson_access a WHERE a.lesson_id=ANY(selected_lessons) AND ((a.type='group' AND a.ref_id IS DISTINCT FROM grp_id) OR (a.type='student' AND a.ref_id NOT IN(teacher_id,student_id) AND NOT EXISTS(SELECT 1 FROM user_groups ug WHERE ug.group_id=grp_id AND ug.user_id=a.ref_id)))) THEN
   RAISE EXCEPTION 'QA graph conflict';
 END IF;
 INSERT INTO organizations(name,timezone,locale,grading_scale) VALUES('QA-школа ENT Ready','Asia/Qyzylorda','ru','points') RETURNING id INTO org_id;
 IF grp_id IS NULL THEN
   INSERT INTO groups(name,city,school,teacher_id,invite_code,category) VALUES('QA 01.11','QA','QA-школа ENT Ready',teacher_id,'QA2611','school') RETURNING id INTO grp_id;
 END IF;
 UPDATE groups SET organization_id=org_id,school='QA-школа ENT Ready' WHERE id=grp_id;
 INSERT INTO organization_members(organization_id,user_id,role) VALUES(org_id,teacher_id,'owner'),(org_id,student_id,'student');
 -- Preserve the existing roster's access, explicitly requested by the owner.
 -- These users are not converted into restricted QA accounts.
 INSERT INTO organization_members(organization_id,user_id,role)
 SELECT org_id,ug.user_id,'student' FROM user_groups ug WHERE ug.group_id=grp_id AND ug.user_id NOT IN(teacher_id,student_id);
 INSERT INTO user_groups(user_id,group_id) VALUES(student_id,grp_id) ON CONFLICT DO NOTHING;
 UPDATE lessons SET group_id=grp_id,visibility='private' WHERE id=ANY(selected_lessons);
 UPDATE tests SET group_id=grp_id,is_public=FALSE WHERE id=ANY(selected_tests);
 UPDATE questions SET generation_allowed=FALSE WHERE owner_id=teacher_id;
 UPDATE lesson_blocks b SET content='qa-asset://subject/'||l.topic_id::text FROM lessons l
 WHERE b.lesson_id=l.id AND l.id=ANY(selected_lessons) AND b.type='image' AND l.topic_id BETWEEN 1 AND 14;
 INSERT INTO qa_workspace_registry(organization_id,default_group_id,teacher_user_id,student_user_id) VALUES(org_id,grp_id,teacher_id,student_id);
 INSERT INTO qa_workspace_accounts(user_id,organization_id,default_group_id) VALUES(teacher_id,org_id,grp_id),(student_id,org_id,grp_id);
 RETURN TRUE;
END $$;

-- Structural invariants also cover writers that bypass an HTTP DTO.
CREATE FUNCTION enforce_qa_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding qa_workspace_accounts%ROWTYPE; other_org INT; parent_author INT; parent_group INT;
BEGIN
 IF TG_TABLE_NAME='groups' THEN
   SELECT * INTO binding FROM qa_workspace_accounts WHERE user_id=NEW.teacher_id;
   IF FOUND AND (NEW.id<>binding.default_group_id OR NEW.organization_id IS DISTINCT FROM binding.organization_id) THEN RAISE EXCEPTION 'QA group boundary'; END IF;
 ELSIF TG_TABLE_NAME='lessons' OR TG_TABLE_NAME='tests' THEN
   SELECT * INTO binding FROM qa_workspace_accounts WHERE user_id=NEW.created_by;
   IF FOUND THEN
     IF NEW.group_id IS DISTINCT FROM binding.default_group_id THEN RAISE EXCEPTION 'QA group boundary'; END IF;
     IF TG_TABLE_NAME='lessons' THEN
       IF NEW.visibility<>'private' THEN RAISE EXCEPTION 'QA publication boundary'; END IF;
     ELSE
       IF NEW.is_public OR NEW.generated_for IS NOT NULL THEN RAISE EXCEPTION 'QA publication boundary'; END IF;
     END IF;
   ELSIF EXISTS(SELECT 1 FROM qa_workspace_registry WHERE default_group_id=NEW.group_id) THEN RAISE EXCEPTION 'QA owner boundary'; END IF;
 ELSIF TG_TABLE_NAME='questions' THEN
   SELECT * INTO binding FROM qa_workspace_accounts WHERE user_id=NEW.owner_id;
   IF FOUND THEN
     IF NEW.generation_allowed THEN RAISE EXCEPTION 'QA generation boundary'; END IF;
     IF NEW.test_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tests WHERE id=NEW.test_id AND created_by=NEW.owner_id AND group_id=binding.default_group_id) THEN RAISE EXCEPTION 'QA question boundary'; END IF;
     IF NEW.context_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM question_contexts WHERE id=NEW.context_id AND created_by=NEW.owner_id) THEN RAISE EXCEPTION 'QA context boundary'; END IF;
   ELSIF EXISTS(SELECT 1 FROM tests t JOIN qa_workspace_accounts a ON a.user_id=t.created_by WHERE t.id=NEW.test_id) OR
         EXISTS(SELECT 1 FROM question_contexts qc JOIN qa_workspace_accounts a ON a.user_id=qc.created_by WHERE qc.id=NEW.context_id) THEN RAISE EXCEPTION 'QA question boundary'; END IF;
 ELSIF TG_TABLE_NAME='test_questions' THEN
   SELECT a.organization_id INTO other_org FROM questions q JOIN qa_workspace_accounts a ON a.user_id=q.owner_id WHERE q.id=NEW.question_id;
   SELECT t.created_by,t.group_id INTO parent_author,parent_group FROM tests t WHERE t.id=NEW.test_id;
   IF other_org IS DISTINCT FROM (SELECT organization_id FROM qa_workspace_accounts WHERE user_id=parent_author) THEN RAISE EXCEPTION 'QA link boundary'; END IF;
 ELSIF TG_TABLE_NAME='user_groups' THEN
   IF NOT qa_resource_access(NEW.user_id,(SELECT teacher_id FROM groups WHERE id=NEW.group_id),NEW.group_id) THEN RAISE EXCEPTION 'QA enrollment boundary'; END IF;
 ELSIF TG_TABLE_NAME='lesson_access' THEN
   SELECT a.* INTO binding FROM lessons l JOIN qa_workspace_accounts a ON a.user_id=l.created_by WHERE l.id=NEW.lesson_id;
   IF FOUND AND ((NEW.type='group' AND NEW.ref_id<>binding.default_group_id) OR
       (NEW.type='student' AND NOT EXISTS(SELECT 1 FROM organization_members m WHERE m.user_id=NEW.ref_id AND m.organization_id=binding.organization_id AND m.status='active' AND m.role IN('owner','admin','teacher','student')))) THEN RAISE EXCEPTION 'QA grant boundary'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER qa_groups_boundary BEFORE INSERT OR UPDATE ON groups FOR EACH ROW EXECUTE FUNCTION enforce_qa_workspace();
CREATE TRIGGER qa_lessons_boundary BEFORE INSERT OR UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION enforce_qa_workspace();
CREATE TRIGGER qa_tests_boundary BEFORE INSERT OR UPDATE ON tests FOR EACH ROW EXECUTE FUNCTION enforce_qa_workspace();
CREATE TRIGGER qa_questions_boundary BEFORE INSERT OR UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION enforce_qa_workspace();
CREATE TRIGGER qa_links_boundary BEFORE INSERT OR UPDATE ON test_questions FOR EACH ROW EXECUTE FUNCTION enforce_qa_workspace();
CREATE TRIGGER qa_enrollment_boundary BEFORE INSERT OR UPDATE ON user_groups FOR EACH ROW EXECUTE FUNCTION enforce_qa_workspace();
CREATE TRIGGER qa_grants_boundary BEFORE INSERT OR UPDATE ON lesson_access FOR EACH ROW EXECUTE FUNCTION enforce_qa_workspace();

SELECT provision_qa_school();
