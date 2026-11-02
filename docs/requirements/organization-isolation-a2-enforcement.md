# A2.2 — tenant enforcement и ручной перенос замкнутого набора

Дата: 02.11.2026. Статус: реализуемый проект контракта для координатора; код не изменён, маршруты ниже **предлагаемые**, кроме явно обозначенных существующих. Основание: решение пользователя о ручном выборе организации, `organization-isolation-a2.md`, UX `../design/organization-transfer-preflight.md`, текущие `handler/routes.go`, обработчики, SQL и frontend. Это следующий этап после A2.1, а не описание уже работающей изоляции.

## Рекомендация и граница поставки

Сначала внедрить схему, защиту всех legacy путей и scoped API, затем проверить их независимо, и только последним шагом зарегистрировать manual apply. Нельзя публиковать один transfer endpoint поверх текущих creator-only API. Допустимый первый перенос: собственная пустая группа, самостоятельный урок/тест либо целая группа с замкнутыми собственными зависимостями, без истории, медиа и внешних связей. Пустые группы и самостоятельные материалы не требуют A3 invitations. Непустой состав требует уже существующих active memberships; перенос никого не зачисляет.

Общий каталог остаётся legacy/global с `organization_id IS NULL`. Перенесённый объект не становится публичным даже при ошибочном флаге. Scoped публикация означает выдачу внутри организации по явным grants, а не публикацию в общий каталог. Копирование из общего каталога, обратный перенос, перенос между организациями, tenant ЕНТ и массовый backfill вне этой поставки.

## Проверенные факты и принятые проектные решения

Факты: legacy API зарегистрированы в `handler/routes.go`; guards находятся в `content_access.go`, `test_access_security.go` и owner helpers в `lessons.go`/`tests.go`. SQL есть одновременно в `db/queries/` и inline в обработчиках. `questions.test_id` и `test_questions` сосуществуют. У `lesson_access` polymorphic `type/ref_id`, у `user_groups` нет организации. Генераторы `topics.go` и `ent.go` выбирают `generation_allowed`; отдельный `/static` сейчас публичен. A2.1 делает RR READ ONLY snapshot и не выполняет перенос.

Принятые минимальные решения (новые бизнес-правила этого проекта, не существующие свойства):

- Scoped роль берётся только из active `organization_members`; глобальная teacher не даёт scoped прав. Owner/admin — права настроек и переноса; авторство материалов при этом не отменяется. Управлять чужими материалами администратор не может. Расширение административных прав — отдельная задача.
- Authoring разрешён active owner/admin/teacher только для собственного материала. Участник student может учиться; parent не получает учебный доступ без отдельной модели связей. Owner/admin/teacher получают ученический доступ к опубликованному материалу только по тем же grants либо как автор; авторский просмотр не расходует попытку. Начинать учебные попытки в первом срезе может только org student.
- Отсутствие организации/active membership, чужая организация ресурса или скрытый ресурс дают 404. Известному active участнику с неподходящей ролью для операции —403; неподходящее авторство скрытого ресурса —404. Пустые списки —200 и `[]`.
- `school/course` не являются org grants. Для scoped уроков допустима только `visibility='private'`; просмотр student — опубликован и group enrollment либо явный `lesson_access` внутри той же организации. Самостоятельный тест без группы доступен автору для управления; студенту до отдельной модели назначения тестов недоступен.
- Пока нет защищённого tenant media storage, scoped image-блоки, `image_url` и `explanation_image_url` запрещены как при переносе, так и при последующем создании/редактировании. Старый `/static` не становится защищённым от добавления org ID.
- Для попыток после первого запуска теста его оцениваемое содержимое и связи вопросов/контекстов/вариантов неизменяемы. Изменение этих данных либо удаление теста с любой попыткой —409 `history_conflict`. Это минимальная замена отсутствующей модели версий попыток. Продолжение теста и finish сохраняют текущие правила времени и лимитов.

## Данные и миграции

Новые последовательные миграции после текущей 025; номер закрепляет backend A после проверки актуального списка. Не менять применённые миграции. Не ставить всем строкам организацию по умолчанию и не создавать memberships.

| Таблица | Изменение / источник scope |
|---|---|
| `groups` | nullable `organization_id INT REFERENCES organizations(id) ON DELETE RESTRICT` |
| `lessons` | такой же nullable org ID; при group_id != null scope точно равен группе |
| `tests` | такой же nullable org ID; scope равен группе при наличии group_id; scoped `is_public=false`, `generated_for IS NULL` |
| `questions` | такой же nullable org ID; scoped `generation_allowed=false`; scope равен обоим типам test links и context |
| `question_contexts` | такой же nullable org ID; все связанные вопросы той же области |
| `test_attempts` | scope наследуется через обязательный `test_id`; отдельная копия org ID не нужна |
| `answer_options`, `lesson_blocks`, `lesson_views`, `student_answers` | наследование через родителя; нельзя проверять только ID дочерней строки |
| `user_groups`, `lesson_access`, `test_questions` | scope через aggregate parents, ограничения ниже |
| `ent_attempts` и дочерние | только global: все referenced questions обязаны иметь org ID null |
| `topics`, `subtopics` | общий справочник; не приватный org content, без org ID |
| `organization_transfer_audit` (новая) | `id BIGSERIAL`, `organization_id INT NOT NULL RESTRICT FK`, `actor_user_id INT NOT NULL RESTRICT FK`, `request_id UUID NOT NULL`, `resource_type TEXT NOT NULL CHECK group/lesson/test`, `resource_id INT NOT NULL`, `selection_revision TEXT NOT NULL`, `counts JSONB NOT NULL`, `moved_ids JSONB NOT NULL`, `result JSONB NOT NULL` (точный success response для replay), `applied_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp()`, `UNIQUE(organization_id, actor_user_id, request_id)` |

Audit хранит только собственные ID и количества, без текстов вопросов, контактов, ответов и токенов. Корневой resource_id не FK: аудит сохраняется после разрешённого удаления пустого ресурса. Audit API в первом срезе нет; запись атомарна с переносом. Индексы `(organization_id, creator_id/id)` с фактическим именем автора для пяти агрегатов; для membership/enrollment и junction нужны индексы по обеим сторонам, проверить уже существующие перед добавлением.

Обязательные DB-инварианты для INSERT/UPDATE/DELETE, включая legacy SQL:

1. Сравнивать nullable scopes через `IS NOT DISTINCT FROM`, а не `=` или `COALESCE(...,0)`. Личные/global связи null↔null остаются допустимыми.
2. `lessons.group_id`, `tests.group_id`, `questions.test_id`, `test_questions(test_id,question_id)`, `questions.context_id` имеют одинаковые scopes на обоих концах. Проверять и изменение parent org ID, а не только запись связи.
3. Scoped `lesson_access(type='group')` ссылается на существующую группу той же организации; student grant — на существующего active member этой организации. Scoped `user_groups` требует существующего active org student. Не сохранять polymorphic ссылку без проверки ref_id.
4. Scoped автор группы/урока/теста/вопроса/контекста должен существовать в целевой организации на момент создания/переноса, с authoring ролью. Отзыв членства в будущем разрешён и немедленно отнимает доступ; он не обнуляет владельца и не требует удаления данных.
5. Scope объекта меняет только transfer flow; обычный DTO не принимает `organization_id`. Scoped→null и org A→B запрещены в A2.2. Parent scope нельзя изменить так, чтобы остались legacy dependents, включая `ent_attempt_questions` и global tests, ссылающиеся на moved question.
6. Scoped publicity/generation/media ограничения проверяются CHECK там, где поля в одной строке, и constraint triggers для cross-table связей. Для содержимого image-блоков — проверка type/content. Произвольный HTML/URL не загружать и не обходить; медиа-поля известного формата блокируются, текстовые ссылки остаются текстом.

Обычные FK не выражают null-safe cross-table scope. Нужны deferred constraint triggers для перехода всего bundle в одной транзакции и проверки конечного состояния; immediate CHECK для локальных полей. Нельзя обойти parent update проверку сохранением неизменившейся junction строки. Отзыв member status не должен нарушать FK на active status: при чтении grants/enrollments учитываются только пока membership active; строки истории сохраняются. Проверка active student при enrollment/grant — на запись, не вечное ограничение, запрещающее отзыв.

Миграция валидирует начальное null-состояние, существующие legacy связи не переписывает. sqlc генерировать только после изменения SQL-источников, одним назначенным исполнителем. Потенциальный рост generated DTO не должен открыть org ID из legacy endpoint: использовать явные response DTO.

## Единый scope и авторизация

Ввести внутренний `LearningScope`: legacy `{OrganizationID:nil}` или org `{OrganizationID:positiveInt32, ActorID, OrgRole}`. Источник org ID — только URL `/organizations/:organizationId/...`; никакого fallback на creator_id, header, query/body и никакого угадывания scope по resource ID. Gin `:organizationId` отличается от существующих child `:id`/`:blockId`/`:qid`.

Scoped middleware проверяет JWT и active membership. Окончательная SQL-проверка scope и прав обязательна в транзакции чтения/изменения; middleware не заменяет её. Не использовать глобальный `RequireRole("teacher")` на scoped authoring routes. Между проверкой и записью не обращаться к h.q на pool: использовать tx-bound queries/DBTX.

Каждый legacy list/read/update/delete predicate включает scope null, включая creator reads. Child-ID queries делают JOIN до агрегата и фильтруют его scope. Каждый scoped запрос фильтрует точный org ID и активность membership; для student также текущие grants/enrollment и публикацию. Автор с inactive membership получает 404 даже при неизменном created_by.

ID в теле/URL (`group_id`, test/question/context/option IDs, reorder block IDs, student ref_id, linked question IDs, answer option IDs) проверяются в том же scope до записи и вместе с root. Mixed reorder и link отклоняются целиком. Не возвращать название или ID недоступного referent в ошибке. Несуществующий/cross-scope ID —404 `resource_not_found`; существующий доступный, но запрещённый тип связи —409 `scope_conflict`.

## Полная карта маршрутов и guards

В таблице L — существующий путь `/api/v1` + suffix; O — новый `/api/v1/organizations/:organizationId` + тот же suffix. Все O требуют active membership. Права «author» — authoring роль и собственность; «learner» — active org student и текущий grant. Поля существующих DTO, pagination и response shape сохраняются, кроме org scope в O response: агрегат содержит обязательный `organization_id:number`; legacy response shape не расширять без необходимости. GET/POST/PUT/DELETE соответствуют текущим `routes.go`; не создавать PATCH-алиасы.

| Семейство suffix / методы | L после A2.2 | O и права |
|---|---|---|
| `POST /groups`, `GET /groups`, `GET /groups/joined` | create null; списки только null | create/list own author; joined learner; создание по существующему createGroupReq |
| `GET /groups/:id`, `GET /groups/:id/students` | root null; существующие ограничения | get author или enrolled learner; roster только собственный author, DTO без контактов |
| `POST /groups/:id/students`, `DELETE /groups/:id/students/:user_id` | root null | author; add `{user_id:positiveInt32}` только active org student, без enrollment в org |
| `POST /groups/join`, `DELETE /groups/:id/leave` | invite lookup/leave только null | O join не регистрировать; O leave learner только из своей scoped группы. Старый invite_code moved группы никогда не работает в L |
| `GET/POST /groups/:id/lessons`, `GET/POST /groups/:id/tests` | null group и все children null | список author/learner с publication predicate; создание author группы и материала |
| `GET /lessons/mine`, `GET /lessons/available`, `POST /lessons` | только null, create null | mine author; available по scope+grants; standalone create author |
| `GET/PUT/DELETE /lessons/:id`, `PUT /lessons/:id/topics` | null root | read author/learner; изменения author; group ref тоже scoped |
| `POST /lessons/:id/publish`, `POST /lessons/:id/unpublish` | null root | author; publish только private/org, не global catalogue |
| `GET/POST /lessons/:id/blocks`, `PUT/DELETE /lesson-blocks/:blockId`, `POST /lessons/:id/blocks/reorder` | parent null, включая child ID | read author/learner; write author; все blocks одного lesson; image запрещён |
| `POST /lessons/:id/view`, `GET /lessons/:id/viewers` | parent null | view learner с read grant; viewers author, только относящиеся к этому lesson данные |
| `GET/POST /lessons/:id/access`, `DELETE /lessons/:id/access/:type/:refId` | parent и refs null/legacy semantics | author; group same scope, student active membership; roster не расширяется автоматически |
| `GET /tests/mine`, `POST /tests`, `GET/PUT/DELETE /tests/:id`, `POST /tests/:id/publish`, `GET /tests/:id/results` | root null | authoring как выше; learner read опубликованного enrolled group test; results только author |
| `GET /tests/public`, `GET /topics/:id/tests` | null tests и только global catalogue | O public/topic catalogue не регистрировать; общий каталог открывается отдельной legacy областью |
| `POST /tests/:id/questions`, `POST /tests/:id/questions/link`, `DELETE /tests/:id/questions/:qid` | null test и question/context | author обоих; link существующего own scoped question; cross-scope нельзя даже public |
| `POST /questions`, `GET /questions/mine`, `PUT/DELETE /questions/:id` | null question, context/test refs null | author; scoped generation/media запрещены; list только свои вопросы |
| `POST /question-contexts`, `GET /question-contexts/mine`, `DELETE /question-contexts/:id` | null context и children | author; атомарное создание context/questions/options; delete запрещён при history/dependent ownership conflict |
| `POST /questions/:id/options`, `PUT/DELETE /options/:id` | question parent null | author; parent/history guard; full grading DTO только автору |
| `POST /tests/:id/attempts` | null root | learner; active membership + current test grant; max_attempts/deadline transactionally |
| `POST /attempts/:id/answer`, `POST /attempts/:id/finish`, `GET /attempts/:id/review`, `GET /attempts/my` | JOIN attempt→test null, даже автор собственной попытки | собственная попытка + exact scope + active membership + актуальный read grant; review дополнительно result policy; list own scoped attempts |
| `POST /topics/:id/random-test` | выбор только null questions, null contexts; generated test null | O не регистрировать: scoped generation вне среза |
| `/ent/start`, `/ent/attempts/my`, `/ent/attempts/:id`, `/answer`, `/finish`, `/result` с существующими методами | global only; каждая question/context/option reference null, attempt owner; никаких moved refs | O ENT routes отсутствуют. Это не означает отсутствия guards в L ENT |
| `GET /users/me/activity` | считать только attempts с parent test null; не раскрывать org activity после revoke | O `/activity` можно отложить; не подмешивать org данные в L |
| `/topics`, `/topics/:id/subtopics`, create topics/subtopics | общие справочники, существующие global permissions | использовать global read, scoped write aliases не нужны |
| `/questions/import`, `/questions/parse-text`, `/upload/image`, `/static/*` | текущие parser/upload не записывают scoped aggregates; возвращённые ссылки не дают scoped media grant | O upload/import aliases не регистрировать в первом срезе; создание через org JSON подчиняется guards |

A2.1 candidates/preflight после добавления org ID выбирают **только legacy null** собственные roots/dependencies. Перенесённое не остаётся кандидатом. Нельзя автоматически присоединять уже scoped child к legacy group. Handler family inventory в таблице — обязательный checklist; совпадение имени owner helper не доказывает покрытие inline SQL.

### Контракт полей и примеры scoped API

Все ID — positiveInt32 JSON number/URL decimal, все timestamps — RFC3339, optional nullable поля сохраняют существующий формат. Scope в request запрещён как неизвестное поле. JSON для новых plan/apply строгий: object, required поля non-null, unknown/duplicate keys, trailing JSON, case-variant имена полей и body >4KB →400. На существующих DTO дополнительно запретить `organization_id`, чтобы старые binder не игнорировали попытку подмены scope.

Пример назначения существующего active student (не создания membership):

```http
POST /api/v1/organizations/42/groups/17/students
Authorization: Bearer ...
Content-Type: application/json

{"user_id":103}
```

201: существующий response enrollment `{user_id:103,group_id:17,...existing fields}`; 404 недоступная группа/участник; 409 `member_not_eligible` при неподходящей роли/status целевого участника, без персональных данных. 403 если active actor не имеет authoring роли. Для unknown/inactive target member предпочтителен общий `member_not_eligible` без различения существования аккаунта; UI показывает «Выберите активного ученика пространства». Не возвращать raw SQL errors.

Пример scoped answer: `POST /api/v1/organizations/42/attempts/71/answer`, тело `{"question_id":55,"option_id":83}`. Оба поля обязательны, positiveInt32, текущая форма `submitAnswerReq`; успешный response сохраняет текущий DTO. Обязательные инварианты независимо от DTO: question входит в attempt test, option принадлежит question, все scopes совпадают, попытка actor и ongoing, срок не истёк. 404 чужая попытка/option; 400 синтаксически неверный payload; 409 `attempt_closed` для завершённой/истёкшей попытки (если legacy сейчас возвращает иной статус, legacy совместимость сохранить, новый O закрепить как 409). Для finish повторный вызов возвращает сохранённый результат, не создаёт новые ответы/баллы.

Точные существующие content DTO берутся из request structs `groups.go`, `lessons.go`, `tests.go`; этот документ не разрешает менять поля оценивания или форматы вопросов. Перед frontend интеграцией backend A/B публикуют examples из реальных response tests в этом документе/приложении. Новые scope поля не должны попадать через generated structs в чужую область.

## Правильные ответы и целостность попыток

- Student test/start/ongoing response не содержит `is_correct`, correct_option IDs, explanations/explanation_image_url и готовые пары matching. Поле `match_text`, если означает ключ соответствия, исключается из исходных пар; shuffled right-hand choices не содержат отображение на верные left-hand IDs. Это проверяется по JSON, а не скрытием в React.
- Author preview допускает grading данные только в scoped author endpoint после scope+ownership guard. Нельзя определять author только по global teacher или наличию owner_id при отозванном membership.
- Review: собственная finished attempt, доступ к test не отозван, затем существующая политика `canSeeResults`: standalone после finish; group после deadline либо всех сдавших. Для org «все» — текущие active enrolled org students, finished count — DISTINCT этих user IDs для этого теста, не число попыток и не завершившие посторонние пользователи. Пока условие не выполнено —403 `results_not_available`, без answer key/explanations. Повторный finish до этого условия тоже не раскрывает ключ.
- Start/answer/finish работают в транзакции. Блокировать test при start, attempt при answer/finish; лимит попыток проверять под той же сериализацией. Запрос answer не выбирает чужие question/option через общий ID. Истечение времени завершается по существующему алгоритму, не принимает поздний ответ.
- ENT сохраняет global-only модель. Start generators фильтруют questions/context null; insert ENT links проверяется DB. Все существующие GET/result/finish paths проверяют owner и отсутствие scoped references, включая ошибочные старые данные. Student ENT result не доступен до finish. `student_answers`/`ent_selected_options` нельзя использовать как обход parent scope.

## Замкнутый bundle и отказ переноса

Начальный closure — A2.1 CTE с добавленным `organization_id IS NULL` у roots и выбранных aggregates. Group включает own lessons/tests этой группы, tests→questions через обе схемы связей, own questions→contexts. Answer options и lesson blocks следуют за своими parents и проверяются полностью, хотя A2.1 counts не имеют отдельных полей для них. Для standalone lesson/test с group_id не null —reject `requires_group_bundle`; не поднимать root автоматически. Каждая строка closure принадлежит actor и null scope. Любой foreign/unowned dependent —reject с обезличенным blocker.

Reject при любом A2.1 blocker: published public catalogue, attempts (ongoing тоже), lesson_views, ENT references, shared questions (legacy test_id тоже), enabled generation, context questions вне набора, roster без active eligible target members, external lesson access, foreign/unowned content, media. Дополнительно:

- Любой материал уже scoped, mixed scope или нарушенный reference —409 `scope_conflict` без частичного переноса.
- `lessons.visibility != private` и `tests.is_public=true` даже если draft —409 `scope_policy_conflict`. Не менять эти флаги молча. Пользователь может явно отредактировать личный draft и перепроверить; опубликованный общий каталог не переносить.
- `tests.generated_for IS NOT NULL` —409 `generated_content`; generated tests не становятся school materials.
- История `student_answers` на выбранные questions через **другой** test/attempt, даже при неконсистентных старых links, также blocker. Проверять прямые ссылки истории, не только test_attempts selected tests. Context deletion cascade не должен унести вопросы вне closure.
- Grant group ref только selected group; grant student должен быть active org student (owner/admin/teacher grants допустимы только если явный продуктовый сценарий принят отдельно). Любой roster user должен быть active org student; actor —active owner/admin. Никакого implicit join/enroll.
- Медиа проверяются в lesson image blocks, question image/explanation image, context image; не скачивать URL, не читать пользовательские пути. Не обещать обнаружение изображения внутри произвольного текста.
- Ограничение первого apply: суммарно не более 10 000 aggregate+dependent rows, включая junction/options/blocks/enrollments/access; больше —409 `bundle_too_large`, без обрезанного результата и записи. Это эксплуатационный лимит, а не возможность batch migration.

Preflight/plan показывают counts только actor-owned aggregates; чужие counts допустимы только как обезличенное количество blocker, без ID/title/text. Отказ apply не возвращает частично перенесённый объект.

## Plan/apply: версионирование относительно A2.1

**A2.1 контракт не переопределять скрытно:** существующий `/transfers/preflight` сохраняет `execution_allowed:false` и `tenant_enforcement_ready:false`; он не является разрешением на запись. Его UI не должен получить кнопку apply по локальному флагу. Чтобы не превратить старый advisory response в capability, A2.2 вводит отдельный readonly plan и apply. Это два новых маршрута, без новых сервисов/технологий. Они регистрируются только после release gate ниже; до этого A2.1 остаётся единственным доступным интерфейсом. Существующую карточку заменяет A2.2 UI по отдельной UX-спецификации; старый текст «изоляция ещё не включена» после релиза A2.2 не показывать как актуальное состояние A2.2.

### `POST /api/v1/organizations/:organizationId/transfers/plan`

JWT, active owner/admin, собственный legacy root. Тело как A2.1: `{resource_type:"group"|"lesson"|"test",resource_id:positiveInt32}`, оба обязательны. READ ONLY REPEATABLE READ, membership перепроверить внутри snapshot. 200:

```json
{
  "resource":{"type":"group","id":17,"title":"Математика"},
  "target_organization_id":42,
  "as_of":"2026-11-02T10:00:00Z",
  "selection_revision":"sha256:64-lowercase-hex-characters",
  "apply_eligible":true,
  "counts":{"groups":1,"lessons":0,"tests":0,"questions":0,"contexts":0},
  "blockers":[],
  "notice":"План не переносит данные. При подтверждении все зависимости проверяются повторно."
}
```

`selection_revision:string` обязателен, формат `sha256:` + 64 hex; это opaque digest, не auth token. `apply_eligible:boolean` равен отсутствию blockers при полностью включённом enforcement; не означает выполненную миграцию. Даже eligible plan может устареть. Заблокированный plan тоже 200, false+blockers. 400 invalid input; 401 JWT; 403 role; 404 membership/root; 500 internal без SQL details.

Digest строится по детерминированному canonical representation: target org ID; actor ID; root type/ID; все выбранные aggregate строки с полями, влияющими на перенос/видимые пользователю свойства; IDs+состояния blocks/options/junction/legacy links; roster/grants; active role/status memberships actor и referenced users; все blocker evidence sets/counts; history refs, public/generation/media flags. Не достаточно updated_at корня (junction/options/membership меняются отдельно). Digest не включает as_of и другие изменяющиеся от самого чтения значения. Digest сервер вычисляет повторно; клиент его не редактирует. Не возвращать canonical evidence или чужие IDs. plan не хранится в БД, не выдаёт confirmation token.

### `POST /api/v1/organizations/:organizationId/transfers/apply`

JWT, active owner/admin и actor ownership как plan. Все поля required non-null:

```json
{"resource_type":"group","resource_id":17,"selection_revision":"sha256:...64 hex...","request_id":"0cd2da94-61a1-4c27-a888-0124aa5f89b9"}
```

`request_id` —UUID созданный клиентом один раз на ручное подтверждение, повтор после timeout отправляет тот же ID и тот же payload. Никаких force/ignore_blockers/target-owner/publicity полей. Успех200:

```json
{"status":"applied","transfer_id":"9","request_id":"0cd2da94-61a1-4c27-a888-0124aa5f89b9","resource":{"type":"group","id":17,"title":"Математика"},"target_organization_id":42,"counts":{"groups":1,"lessons":0,"tests":0,"questions":0,"contexts":0},"applied_at":"2026-11-02T10:01:00Z"}
```

Все response поля обязательны; transfer_id — decimal string positiveInt64, чтобы не терять точность в JavaScript, counts nonnegative integers. Повтор с тем же actor/org/request_id и payload возвращает тот же результат200 без повторного UPDATE. Если membership actor отозван, replay также 404 —audit не обход авторизации. Request ID с другим payload —409 `idempotency_conflict`. Если данные уже moved другим request_id —409 `already_scoped`; чужой inaccessible root по-прежнему404.

Ошибки `{error:string,code:string}`; для `transfer_blocked` дополнительно `{blockers:[{code:string,count:nonnegativeInt,message:string}]}` без foreign IDs. 400 invalid payload/UUID/revision/size; 401 no JWT; 403 active role insufficient; 404 org/root inaccessible; 409 `selection_changed` (перепроверить plan), `transfer_blocked`, `already_scoped`, `idempotency_conflict`, `bundle_too_large`; 503 `retry_later` при исчерпанном lock/serialization retry budget; 500 unexpected. Ни один отказ не коммитит изменение scope. Никакого frontend auto-retry apply с новым request_id.

### Транзакция и конкурентные изменения

Нужна защита не только существующих строк, но и от вставки новых edges/attempts/ENT links. Минимальный корректный протокол первого среза: **один документированный transaction-level advisory lock для всего learning graph**, например `pg_advisory_xact_lock(2202,1)`, во всех записях агрегатов, questions/options/contexts/blocks, links/grants/rosters, attempts/views, random/ENT generation и изменениях organization membership. Lock берётся первым, до чтения/row locks; все перечисленные writers работают в явной транзакции. Это сознательная временная сериализация writes вместо незавершённого fine-grained locking; read-only requests не блокируются. После нагрузки можно заменить на проверенный per-root протокол, но не в процессе этого этапа.

Apply выполняется в READ COMMITTED write transaction: сначала advisory lock (отдельный statement), затем чтения нового committed snapshot, organization row и membership actor `FOR UPDATE`; root+все closure rows в стабильном table/ID порядке `FOR UPDATE`; referenced memberships —`FOR SHARE`. Все writers и membership changes соблюдают тот же lock, поэтому после lock граф не меняется до commit. Не использовать REPEATABLE READ snapshot, начатый до ожидания advisory lock: он может оказаться устаревшим. RR остаётся только для advisory plan/preflight.

1. Внутри транзакции проверить active owner/admin, затем idempotency record; на replay вернуть неизменный audit result.
2. Root lookup и closure —исключительно null+actor-owned; все зависимые/ref/history строки проверить заново. Проверить лимит, blockers и revision с планом. Предварительный HTTP plan никогда не заменяет этот шаг.
3. Обновить organization_id ровно у пяти aggregate sets; не менять creator, publication, user_groups, grants, attempts, timestamps истории и не добавлять участников. Scope descendants наследуется. Временная несогласованность допустима только до deferred constraints в этой транзакции.
4. Проверить количество обновлённых строк и deferred constraints (`SET CONSTRAINTS ... IMMEDIATE`), добавить audit, commit. Любое расхождение —rollback.
5. Response после commit. При разрыве соединения после commit повтор того же request_id восстанавливает результат.

Обязательный gate: если хотя бы один inline/raw writer вне протокола (включая `RecordView`, `Unpublish`, `CreateZeroAttempt`, ENT/random insertion, member revoke), apply не регистрировать. DB constraints дополнительно исключают cross-scope graph; advisory lock не считается заменой constraint/SQL authorization. Перед production оценить блокировки и время на тестовой БД; lock timeout+transaction timeout конфигурируются без секретов и без бесконечного ожидания. Масштабируемые блокировки не вводить без измеренной необходимости.

## Frontend и сценарии

Новая UX-концепция для apply обязательна до реализации UI: A2.1 дизайн специально исключает подтверждение/выполнение, его нельзя считать готовым дизайном destructive scope change. Предлагаемый сценарий: организация→тип+собственный материал→план→объяснение смены доступа→ручное подтверждение конкретных source/target/counts→apply→ссылка в scoped экран. Не обещать перенос истории, файлов или «всех материалов».

Scoped URL обязателен в адресе страницы и каждом API call/query key; переключатель организации не является единственной защитой. Использовать `user.id/sessionVersion/org ID/resource ID` в keys, очистить old report/plan при смене контекста. Global catalogue открывать явно отдельно; ссылки из O не должны вести на legacy detail. После apply invalidation legacy candidates/own lists и O lists; legacy old URL корректно показывает недоступность, без редиректа, раскрывающего чужую организацию.

Минимальный frontend не обязан дублировать весь editor до backend release: но перед включением apply должны существовать рабочие O list/detail для каждого разрешённого типа, author content/roster и student lesson/test/attempt/review, иначе перенос оставляет пользовательский сценарий незавершённым. Можно переиспользовать view/editor components с обязательным scope prop; не копировать legacy API strings. Unsupported O ENT/random/import/media действия отсутствуют, показывается ясная граница, без fallback в global mutation.

## Ownership файлов и порядок интеграции

Два backend исполнителя могут работать параллельно только после согласования `LearningScope`/tx helpers. Никто не правит чужой файл одновременно. Backend A —единственный владелец общих migrations/query generation/routes/config; backend B присылает SQL-source additions отдельным согласованным patch/описанием, A интегрирует и генерирует. Нельзя одновременно запускать sqlc generate из двух задач.

| Исполнитель | Исключительное владение | Зависимости / проверяемый результат |
|---|---|---|
| Backend A: scope foundation, groups/lessons, transfer | `handler/routes.go`, `handler/organizations.go`, `handler/organization_transfers.go`, новые `handler/learning_scope.go`, `handler/organization_transfer_apply.go`; `handler/content_access.go`, `handler/groups.go`, `handler/group_dto.go`, `handler/lessons.go`; `db/migrations/*` новые, все `db/queries/*`, `db/sqlc/*`, при необходимости `config/*`/`.env.example`; group/lesson/transfer tests | схема+constraint triggers, common tx/advisory+scope helpers, complete legacy/O group/lesson guards, plan/apply (registration только после gate). Export helper signatures до старта B. Не менять tests/ENT файлы B |
| Backend B: test graph, attempts, generators | `handler/tests.go`, `handler/test_access_security.go`, `handler/topics.go`, `handler/ent.go`, `handler/activity.go`, tests этих семейств; `handler/import.go`/`upload.go` только если guard audit покажет реальную запись references | все legacy/O tests/question/context/option/attempt guards; immutable-after-attempt; global-only generators/ENT/activity; все writes общий tx protocol. SQL потребности передать A, не править generated/routes |
| Frontend | `frontend/src/lib/organizations-api.ts`, новый `frontend/src/lib/learning-api.ts`; `frontend/src/app/teacher/organizations/page.tsx`, `transfer-preflight.tsx`, новые O routes под `frontend/src/app/organizations/[organizationId]/...`; выделяемые shared lesson/test/editor components; существующие teacher/student pages только для извлечения компонентов/явного legacy scope | сначала UX apply+navigation; весь новый API слой O, query keys и session/late response guards; рабочие author+student сценарии; не трогать backend/общий auth api без согласования |
| Координатор/architect/tester | документация/приёмка, независимые tests в отдельных файлах после freeze; назначенный один интегратор fixtures | matrix coverage, security review до регистрации apply, реальная тестовая БД изолирована; production migrations только по разрешению |

Backend A не включает apply routes, пока B не подтвердил полный checklist; наличие функции в исходнике без route не считается публикацией. Сначала схема без moved данных и исправленные L guards, затем O handlers, затем независимая проверка, затем регистрация plan/apply и frontend enablement в одном согласованном release. Не использовать случайный frontend feature flag как серверную защиту. Не создавать существующие production tenants/backfill ради теста.

## Приёмка и release gate

1. Пользователь имеет legacy root и членство owner org A; другой пользователь/глобальный teacher/owner org B не может читать/менять root через O A. После переносa actor теряет доступ к нему во **всех L paths**, включая blocks/options/contexts, mine lists, reviews/results, topic catalogue, joined lists и activity.
2. После revoke active membership бывший автор/ученик теряет O direct/list/attempt/review доступ. Own creator ID, enrollment и старый invite_code не обходят revoke. Родитель или inactive admin не получает учебные ответы.
3. Каждое семейство таблицы маршрутов: null/O A/O B ресурс, owner/member/nonmember, доступный/недоступный foreign ref. GET не выдаёт title/body/count чужого объекта, mutations не меняют строки при отказе. Проверить прямые child IDs и смешанный reorder/link, grant чужой группы/пользователя.
4. Empty group и standalone private lesson/test без истории проходят plan/apply; nonempty group только с eligible active roster. Ownership сохраняется, org ID установлен во всём closure, raw global responses не содержат moved данных. Audit ровно один, никаких membership inserts.
5. Каждый blocker независимо отклоняет apply без изменения всех затрагиваемых таблиц: draft publicity, public published, images каждого поля, tests.generated_for, attempts/views/ENT/student_answers references, shared legacy+junction/context, unowned/foreign, missing membership, external grant, size limit. Counts не размножаются join-ами, legacy+junction question counted once.
6. Конкурентные apply vs link/create child/start attempt/record view/revoke membership/ENT generation обязаны сериализоваться. Если конкурентная запись перед lock —plan revision changed/blocker; если после commit —scope guard не допускает global edge. Нельзя получить mixed scope или lost history. Проверить настоящими двумя соединениями тестовой БД.
7. Plan устарел при смене roster/options/title/publication →409 selection_changed. Retry same UUID возвращает тот же успех, changed payload→409; timeout после commit не приводит к повторной миграции. Ошибка audit/constraint откатывает весь перенос.
8. O student start/ongoing не выдаёт answer key; finish/review до release policy тоже. Question/option чужой attempt→отказ; concurrent start не превышает max_attempts; finish повторно не меняет score; content edits после attempt→409.
9. Global random/ENT не выбирают scoped questions даже при вручную ошибочном generation flag (DB должна не допустить flag). Existing global history сохраняется. Published global catalogue остаётся доступен и не получает org-private content.
10. Scoped frontend list/detail/editor/learner flows используют O API, смена org/account очищает plan/result; request_id сохраняется при uncertain apply; нет автоматического force/retry с новым UUID. Проверить mobile/keyboard и дизайн после UX согласования.
11. Реально выполнить gofmt, `go test ./...`, `go vet ./...`, SQL generation/diff, frontend lint/build; DB checks только на изолированной тестовой БД, без параллельного разрушения fixtures. Непроверенные family/гонки/ошибки DB означают невыполненный gate, не «почти готовую изоляцию».

## Реальные зависимости и ограничения

- Текущие guards недостаточны: creator-only reads/writes, direct children, SQL generators и агрегированная activity требуют изменений нескольких файлов. Это не локальная миграция одной таблицы.
- A2.1 CTE —основа closure, но не готовый transfer validator: ему нужны null filters, active org student policy, direct historical refs, draft flags/generated/media checks и concurrency protocol. Обновить A2.1 blocker messages/count tests соответственно без enabling его false flags.
- Существующий frontend в основном использует inline `api` calls; требуется выделение scoped API boundary и явная маршрутизация, а не добавление одного organization selector. Shared components требуют coordinated extraction одним frontend исполнителем.
- Нужна UX-спецификация apply и org navigation: текущая покрывает только read-only подготовку. Новый plan endpoint выбран для совместимости A2.1; альтернативное версионирование может утвердить координатор **до** реализации, но нельзя молча поменять false flags A2.1.
- Полноценные org media, versioned content/history migration, межорганизационное копирование, массовое зачисление и tenant ENT отложены. Они не блокируют закрытый срез, потому что запрещённые данные/операции отклоняются и соответствующих endpoints нет.
- Coarse advisory lock корректен при полном покрытии writers, но ограничивает write throughput. Это принятый компромисс первого среза, проверить нагрузкой; пропущенный writer —release blocker.
- Нет заявления о защищённом static storage и нет production изменений в рамках этого документа. Запуск production migrations/публикация требуют отдельного разрешения согласно AGENTS.md.

- Проверить orphan media: отсутствие image-полей не доказывает отсутствие ранее загруженных файлов или копий URL в кэше/текстах. Apply не удаляет и не приватизирует legacy uploads; не заявлять retroactive privacy. Известные media references запрещены, перенос хранения — отдельная зависимость.
- Проверить SQL drift: обновление только db/queries не покрывает inline pool.Query/Exec, и изменение SELECT * после добавления колонок может сломать ручной Scan (особенно scanQuestions в ENT). В тестах сравнить schema/query/generated models и каждый explicit scanner; устаревшую генерацию не исправлять вручную.
