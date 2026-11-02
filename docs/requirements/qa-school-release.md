# Выделенная QA-школа — ограниченный production-срез

Дата: 02.11.2026. Постановка пользователя: собрать созданные нами тесты/уроки и тестовые аккаунты в специальной QA-школе и выкатить результат. Это отдельный QA-контур на существующем group-based API, не объявление готовности полного A2 или мультитенантного SaaS.

## Подтверждённые факты

- Учебный доступ в текущем коде опирается на автора, user_groups, публичность и lesson_access. Одной подписи школы недостаточно.
- `requireLessonOwner`, `requireBlockOwner`, test/question/option/context owner helpers сейчас не проверяют organization membership. `lessonReadPredicate` и `canReadTest` также допускают автора независимо от членства.
- Списки и генераторы имеют отдельные SQL-пути: lessons mine/available, groups mine/joined, tests mine/public/group/topic, attempts/activity, question bank/context, random tests и ЕНТ. Их нельзя считать автоматически закрытыми после изменения одного helper.
- Созданные QA-аккаунты: `qa.teacher.20261101@example.test` (global teacher) и `qa.student.20261101@example.test` (global student). Существующая группа — `QA 01.11` у данного преподавателя. QA-уроки имеют созданный нами префикс `QA`, тесты уже назначены этой группе. Реальные IDs определяются по серверным данным, не по числам из примера.
- История двух тестовых попыток и просмотров должна сохраниться. Удаление/пересоздание ресурсов не требуется.

## Минимальная модель

Новая миграция после025: nullable `groups.organization_id` FK на organizations и таблица привязок `qa_workspace_accounts` (user_id PK, organization_id FK, default_group_id FK). Названия/тип реализации допустимо уточнить backend без изменения поведения. Привязка — server-owned, не поле публичного profile/update DTO. Уникальный канонический QA-контур определяется registry, а не названием организации. Пользователь не может сделать свой аккаунт QA/owner через JSON.

Эта модель достаточна только при **явной ограничительной политике QA-аккаунтов**: они тестируют контент своей единственной QA-группы, а не произвольные организации. Для обычных пользователей и не-QA групп прежнее поведение сохраняется. Общий каталог остаётся самостоятельной legacy областью, QA-контент туда не попадает.

## Idempotent provisioning

SQL-функция/серверный helper вызывается миграцией и непосредственно из тестовых fixtures. Никакого публичного универсального transfer/apply endpoint.

1. Одна транзакция и advisory lock на QA-provisioning. Найти обе точные почты и проверить global roles. Если одна/обе записи ещё отсутствуют — no-op/not_ready без создания пользователей и паролей (пустая тестовая БД должна мигрировать). Несовпадение ролей или неоднозначная целевая группа — fail closed.
2. Если registry уже существует, проверить согласованность org/group/аккаунтов; повтор не создаёт новую организацию/группу и не переактивирует отозванное членство. `ON CONFLICT` не должен молча переписывать чужую роль, организацию или статус.
3. Для первого provision создать организацию «QA-школа ENT Ready», owner membership преподавателя и student membership ученика. Переиспользовать его группу `QA 01.11` (если отсутствует, создать только для этого QA-преподавателя); назначить group.organization_id, school label и QA-привязки. Уточнение пользователя: сохранить доступ существующего ученика Амре. Существующий состав этой QA-группы сохраняет enrollment и получает student membership школы для прежних материалов; обычные аккаунты этих учеников не становятся ограниченными QA-аккаунтами, их прочий доступ не меняется.
4. Выбрать только уроки/тесты **этого QA-преподавателя** с созданным нами префиксом `QA`. QA-уроки связать с default_group_id, QA-тесты оставить/назначить той же группе. Все они остаются приватными (`lessons.visibility='private'`, `tests.is_public=false`), publication state сохраняется. IDs, даты, lesson_views, test_attempts, student_answers, options и результаты не удалять/не пересоздавать.
5. Вопросы и контексты QA-автора остаются у него; generation_allowed выключить для QA-вопросов и запретить последующее включение. Перед привязкой проверить оба question↔test способа, контексты, roster/grants и ссылки ЕНТ/генерируемых тестов. Чужие/бесхозные зависимости, общий вопрос/контекст с не-QA ресурсами или предоставления доступа вне QA-набора/сохранённого состава — конфликт и rollback, без изменения реальных данных.
6. Индивидуальные lesson_access/grants должны оставаться внутри QA-группы/active QA-состава; ничего не расширять. Существующие данные других авторов и общий каталог не менять. Повтор provisioning должен давать тот же результат и сохранять количество ресурсов/истории.

Функция не является разрешением на перенос любого пользовательского графа. Её production scope фиксирован этими искусственными аккаунтами и их QA-материалами. После деплоя нужно проверить итоговые counts и отсутствие post-migration conflicts; no-op не выдавать за успешное создание школы.

## Обязательная серверная политика

У QA-привязанного пользователя каждый защищённый запрос должен проверять active membership нужной организации. Можно централизованно загрузить QA context после JWT и отказать всему QA learning flow после revoke; logout остаётся возможным. Это закрывает author/child/list/attempt paths для отозванного QA-аккаунта, но не заменяет проверку принадлежности источника.

- Новые QA-уроки/тесты автоматически получают default_group_id; явный чужой/null override не позволяет обойти назначение. QA-группа одна: создание групп вне контура, перепривязка ресурсов и публичная публикация запрещены понятным403/409. Приватные publish/unpublish/редактирование в QA-школе работают.
- QA списки groups/lessons/tests/attempts/activity возвращают только соответствующий QA-контур; нельзя смешать общий каталог с QA-назначениями. Банк QA-автора остаётся доступен только ему при active membership.
- Прямые lesson/block/test/question/option/context и attempt/answer/finish/review проверки должны сохранять текущие ownership/enrollment rules и QA scope. QA-аккаунт не может читать/изменять/проходить чужие тесты/уроки через подстановку ID. Чужой пользователь не получает QA-доступ через public flags, invite code или grant.
- Join/AddStudent в организации требует active membership целевой QA-школы; QA-аккаунту нельзя вступить в другую группу. Произвольный ID ученика и знание кода приглашения не создают org membership.
- QA GrantAccess только на default QA-группу/разрешённого active QA-участника. Установка public visibility/flags должна отвергаться также в UPDATE/Publish, а не только при создании. DB-инвариант/trigger рекомендуется как защита от пропущенного writer; backend должен вернуть понятный отказ и проверить SQL errors.
- Общие random/ENT selectors **всегда** исключают QA-owned questions, независимо от ошибочного generation_allowed. Для QA-аккаунтов random/ENT creation вне QA-школы недоступны; UI скрывает или объясняет этот режим. Условие только `generation_allowed=false` без запрета повторного включения недостаточно.
- Существующий общий каталог обычных пользователей не переименовывается и не исчезает. Эти гарантии не означают изоляцию произвольной школы/любого автора.

Реализованный QA-контекст: `GET /api/v1/qa/context`:200 `{is_qa:true,active,organization_id,organization_name,group_id,group_name,role}` для привязки;200 `{is_qa:false}` для обычного аккаунта;401 без сессии. При отзыве или несовместимой роли active=false, учебные API403; профиль и выход доступны. Не включать почты, пароль, invite_code и чужой roster.

## Сохраняющиеся QA-иллюстрации

Координатор подготовил immutable PNG: `handler/qa_assets/subject-1.png` … `subject-14.png`, всего208380bytes. Backend embed, без external download и без зависимости от ephemeral uploads.

- В image-блоках соответствующих QA-уроков заменить только content на `qa-asset://subject/{1..14}` по существующему topic_id. IDs блоков, caption/order и история сохраняются. Технический урок без предмета/изображения не изменять этим правилом.
- `GET /api/v1/qa/assets/subject/:topicId`: существующая JWT-сессия и active QA-school membership; id1..14, неизвестный asset404, без авторизации401, отозванный/чужой доступ404/403 без bytes. `Content-Type:image/png`, `Cache-Control:no-store`, `X-Content-Type-Options:nosniff`. Никаких путей/имен файлов от клиента. Endpoint не перенаправляет в public `/static`.
- Общий authenticated image component frontend распознаёт строго этот marker, вызывает существующий api с `responseType:'blob'`, создаёт object URL и отзывает его при смене источника/аккаунта/размонтировании. Late blob предыдущей сессии не показывать. Обычные HTTP/static картинки обрабатываются как прежде.
- Переиспользовать component в student renderer, teacher preview и editor preview; проверить все три места по исходникам. Marker не является произвольной схемой или основанием открыть локальный файл. Ошибка загрузки показывается понятным состоянием, не ложной успешной картинкой.

Это исправляет сохранность **данных14 тестовых иллюстраций** между деплоями. Произвольные загрузки пользователей и общий Railway storage остаются отдельной инфраструктурной задачей.

## Ownership реализации

- **Backend (один исполнитель):** новая migration/provisioning/QA registry+helpers/middleware/routes, затронутые groups/lessons/content_access/tests/test_access/topics/ent/activity/users, protected assets endpoint и embed. Все SQL source/generated изменения — только этот исполнитель и sqlc generation; учитывать ранее обнаруженный legacy SQL drift. Файлы PNG копирует координатор, backend не заменяет их. API business mutations и provisioning должны проверять ошибки; нельзя оставить unhandled DB-trigger errors как успешный204.
- **Frontend:** authenticated asset component и его три места, QA context types/query/badge/ясная граница учебного пространства, defaults/forms для QA и скрытие unsupported global generators. Не менять backend/PNG.
- **Tester:** отдельные QA integration tests, fixtures вызывают idempotent provision на изолированной БД; не запускать параллельно с backend на общей тестовой БД.
- **Координатор:** интеграция, негативный route checklist, production deployment с авторизованной миграцией и проверка настоящего QA-учителя/ученика. Не объявлять готовым полный A2/SaaS.

## Release gate

1. Empty DB migrations проходят; absence QA identities=no-op. Fixtures с двумя QA-identities создают ровно одну школу/группу и две правильные memberships; повтор не дублирует и не переактивирует revoke.
2. Существующие QA IDs, количество тестов/уроков/вопросов/блоков, attempts/answers/views сохраняются. Чужие строки неизменны. Конфликт shared/foreign graph откатывает всё.
3. QA teacher/student могут работать с нужными уроками/тестами и историей. Неподтверждённый/не-QA/чужой/отозванный пользователь не читает QA-resource, child/options/review/assets и не меняет их.
4. QA teacher не может создать, перепривязать, выдать grant или опубликовать QA-контент за пределы школы. QA student не начинает чужие attempts и не создаёт global ENT/random content. Общие генераторы не получают QA-вопросы даже при искусственно выставленном ошибочном флаге.
5. Все14 PNG возвращают реальные bytes члену QA; чужой401/403/404. После нового deploy картинки по тем же marker доступны. Старые uploads не выдавать за исправленные.
6. gofmt, независимые negative/positive API tests, `go test ./...`, `go vet ./...`, frontend lint/build. Реальный production UI после выкладки: школа обозначена,14 предметных уроков+14 тестов(+technical lesson) на месте, картинки декодированы, хотя бы positive/negative score и review проверены.

Документ — анализ и контракт. Runtime и production в ходе подготовки этого документа не проверялись.
