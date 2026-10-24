# Техническое задание frontend: спокойная учебная среда ent-ready
Дата: 23.10.2026. Статус: готово к передаче разработчику; продуктовый код не менялся.

Основания: [BA](01-business-research.md) → [UX/UI](02-ux-ui-design.md) → это ТЗ. Прототип — визуальная иллюстрация; источник требований и правил — документы и действующий сервер. Текущий UI исследован по коду, runtime/браузерный аудит не выполнялся. Путь исходников: C:/Users/HomePC/ent-ready-master.

## 1. Граница итерации
Редизайн UI foundations и оболочки обеих ролей; /student, /student/ent (подготовка/история), /student/tests/[id] (старт/прохождение/итог), /teacher (группы), /teacher/tests (список/создание). /student/results/[attemptId] затрагивается только для согласованного отображения существующего разбора и locked state; без перестройки всей истории. Остальные маршруты получают только совместимые общие компоненты и регрессионную проверку. Не меняем URL, роли, серверные права, способы подсчёта, schema, зависимости и API.

Конечное состояние A: ученик на desktop/mobile открывает реальный назначенный тест либо предмет, видит отдельный вход ЕНТ; ответ имеет честный статус сохранения, обычная попытка завершается и показывает баллы/разрешённый разбор. Конечное состояние B: учитель находит свои группы и тесты, создаёт их прежними запросами, различает publication/public; редакторы остаются действующими. Конечное состояние C: shell и обе темы последовательны, ошибки/пустые данные различимы, клавиатура и mobile работают, security flow сохранён.

## 2. Трассировка и задачи по файлам
Все пути ниже относительно frontend/. Единственный frontend исполнитель владеет общими компонентами и API types; параллельное редактирование этих файлов запрещено. Конкретное извлечение компонентов допустимо внутри указанной зоны без изменения стека.

| ID | BA → UX | Файлы / действие | Проверяемый итог |
|---|---|---|---|
| FE-01 | Единая среда → токены/оболочка | src/app/globals.css; src/components/ui/{button,input,card}.tsx; src/components/nav.tsx; src/app/{student,teacher}/layout.tsx. Внедрить палитру/размеры из UX; foreground логотипа; aria-current; sidebar 224px на md+, safe-area mobile nav; общий PageHeader/SectionHeader при необходимости в components/ui. | Темы, focus, 44px hit targets; длинные labels; shell не закрывает контент. Нет изменений session/logout/cache. |
| FE-02 | Ошибка не пустота → состояния | Новые src/components/ui/async-state.tsx, status-message.tsx либо эквивалент; самостоятельные loading/error/retry/empty/no-results. Подписанный Input и inline validation. | Loading не показывает «ничего нет»; safe error; retry; input сохранён. |
| FE-03 | Найти тренировку → student home | src/app/student/page.tsx; при необходимости components/student/assigned-test-card.tsx, subject-card.tsx. Назначения первым блоком; предметы/поиск; спокойный ENT link; dedupe tests by id после объединения групп. | max_attempts — максимум, не остаток; никакого guessed completed/deadline. Независимые состояния источников, reset search. |
| FE-04 | Полный ЕНТ отдельно → prep | src/app/student/ent/page.tsx; переиспользовать FE-02. Состав из 5 предметов, профильные значения по current user + topics, link profile при отсутствии. Сохранить текущую историю/действия. | Нет обещаний 120/240/140; реальный null finished_at только для ENT «В процессе»; pending start защищён от double click. |
| FE-05 | Доверие к ответу → runner | src/app/student/tests/[id]/page.tsx; извлечь components/test/{question-card,answer-save-status,attempt-result}.tsx и lib/test-attempt-state.ts по необходимости. Единая state machine, очереди answer, barrier finish, один countdown; MathText сохранён. | Сценарии раздела 4, включая failure/timeout, честный процент и locked review. |
| FE-06 | Рабочее место учителя → groups | src/app/teacher/page.tsx. Список по real group DTO; inline create с name/city/school/category, валидация/pending/error/success; не очищать ввод на error/cancel без решения. | Открыть группу; create invalidates actual group query; фокус/сообщение успеха; никаких вымышленных description/statistics. |
| FE-07 | Рабочее место учителя → tests | src/app/teacher/tests/page.tsx. Список/локальный subject filter/grouping; mobile cards; создание тем же payload, сохранение null semantics и timezone deadline. | is_published и is_public разные бейджи; «Не публичный» при false; title не обрезан; opening editor/results прежними путями и правами. |
| FE-08 | Контракт без догадок → types | Новые src/lib/types/learning.ts или локальные точные types. Исправить legacy time_limit wrapper access в student home; shared Nav avatar_url string|null. Ограниченные правки потребителей shared user type в store/auth.ts только при необходимости совместимости, без изменения session lifecycle. | TypeScript соответствует сериализатору, обе null/non-null ветки; UI не требует отсутствующих полей. |
| FE-09 | Разбор с ограничением → review | src/app/student/results/[attemptId]/page.tsx + FE-05 result component. Результат без обещания загрузить закрытые ответы; корректные labels. | can_see_answers=false и review 403 не раскрывают answers; max_score=0 не NaN/Infinity. |
| FE-10 | Независимая приёмка → QA | tests/ для значимой логики очередей/таймера/процентов; существующие auth regression; tester checklist по разделу 7. | Отчёт с реально выполненными командами/сценариями, отдельный список legacy failures. |

## 3. Текущий API и wire fields
Общий клиент src/lib/api.ts, base `/api/v1`. Авторизация/refresh/retry/cancellation только существующим api. Не использовать fetch/новый Axios для обхода interceptors. 401 обрабатывается текущим auth flow, 403/404 — material unavailable либо конкретный permitted review state. {error:string} не выводить пользователю сырьём, безопасно сопоставлять известные сообщения.

В установленном pgx v5.7.2 Int2/Int4 MarshalJSON => number|null, Text => string|null, timestamps => ISO string|null. Это проверено по локальному исходнику зависимости. Legacy frontend {Int16,Valid}/{String,Valid} — ошибка типов, не wire format. Время в минутах, даты передавать как существующий RFC3339; не менять timezone semantics при редизайне.

| Использование | Запрос / response / ограничения |
|---|---|
| Предметы | GET /topics => {id:number,name:string}[] |
| Назначения | GET /groups/joined => группы; GET /groups/:id/tests => {id,title,max_attempts,is_published,time_limit:number|null,...}[]; published filter, dedupe id, ошибки per source. При группе с ошибкой показать частичность, не писать что назначений нет. |
| Группы teacher | GET /groups => {id,name,city,school,teacher_id,category,created_at,updated_at,invite_code?}[]; description отсутствует. POST /groups {name,city,school,category}; источник истины handler/group_dto.go и groups.go. Invite_code только owner. |
| Teacher tests | GET /tests/mine, /groups, /topics; POST /tests {title,group_id,topic_id,max_attempts,time_limit,is_public,deadline} с прежними nullable значениями. GET response содержит is_published/is_public. Link editor /teacher/tests/:id, result /teacher/tests/:id/results. |
| Test entry | GET /tests/:id => {test:{id,title,time_limit,max_attempts,is_published,is_public,deadline,...},questions:[...]}. Начать POST /tests/:id/attempts без payload => 201 {attempt_id,test:{title,time_limit},questions:[{id,text,order_num,points,options:[{id,text,order_num}]}]}; попытка без correct flags. Start error: 403 no attempts remaining / test deadline passed; 404 недоступный. |
| Answer | POST /attempts/:id/answer {question_id:number,option_id:number}. Только single option scalar обычного теста; не подменять ENT option_ids. Не загружать правильность ответа для стилизации в ходе попытки. |
| Finish | POST /attempts/:id/finish => {score:number,max_score:number,can_see_answers:boolean,deadline:string|null,questions?:[{id,text,is_correct,options:[{id,text,is_correct,chosen}]}]}. Баллы weighted; процент = score/max_score*100 и подпись «% от максимального балла». |
| Review | GET /attempts/:id/review => {score,max_score,questions:[{id,text,points,is_correct,options:[{id,text,is_correct,chosen}]}]}; 403 {error,deadline?} — разбор закрыт. Отсутствие questions не компенсировать загрузкой ответов чужим endpoint. |
| ENT prep | user.profile_subject1/2:number|null; GET /topics; GET /ent/attempts/my; POST /ent/start. Существующие маршруты /student/ent/:id и result не перепроектируются. ENT answer отдельный {question_id,option_ids:number[]}; не переносить обычную state machine автоматически. |

Статистика глобального прогресса не добавляется: GET /attempts/my возвращает только finished, limit default 50/max 200, offset, без total. GET обычной активной попытки и resume отсутствуют.

## 4. State machine прохождения и обязательная корректность
Состояния: entry.loading/error/ready → starting → active → finishing → finished. starting/finishing отключают повторный submit. Ошибка start возвращает понятный entry error без повторного автоматического создания попытки. Страница не обещает resume после reload; предупреждение о потере локального состояния при внутреннем уходе и browser beforeunload при активной попытке по возможностям браузера. Нельзя гарантировать срабатывание beforeunload на mobile.

### Ответы: последовательность без ложного успеха
Для каждого question_id держать selectedOption, confirmedOption, localRevision, pendingRevision, error. Максимум один in-flight запрос на вопрос. Новые выборы во время записи заменяют желаемое latest значение; после success текущего отправить последнюю ещё неподтверждённую revision, промежуточные выборы можно coalesce. Ответ старой revision не помечает новую selected как saved. Status slot не скачет: saving → saved только latest confirmed, error → явный retry. При error не стартовать параллельную retry; очередь сохраняет latest desired. На обычном пути «Далее» разрешено после выбора по прежнему workflow, но статус должен оставаться доступен; final submit только после всех текущих выбранных ответов confirmed и отсутствия pending/error. Не добавлять новые пропуски/произвольную навигацию.

Важное ограничение: network error может означать unknown server outcome. Без server revision/idempotency frontend не докажет порядок при ответе потерянном после commit. В пределах MVP: latest-wins означает **клиентское упорядочивание**, не распределённую гарантию. Retry пишет последнее выбранное значение; при неоднозначности честный статус «Не удалось подтвердить сохранение». Не делать незаметный auto-finish, утверждающий все ответы saved.

### Finish и expiry
При manual finish: заморозить новый ввод, дождаться очередей и проверить latest confirmed; при error вернуть active с явным списком/статусом проблем и возможностью retry, без потери selected. Finish не обгоняет queued saves.
При локальном expiry: заморозить ввод, прекратить новые answer/retry; не ждать бесконечно failed queue. Дать уже выполняющимся writes ограниченный сетевой timeout (например 10 секунд), затем выполнить finish один раз независимо от ошибок записи; сообщить, что неподтверждённые ответы могли не попасть в результат. Не ретраить поздние answer после finish. Server expiry авторитетнее локального времени; известный ответ expired переводит в этот же flow. Повтор finish после network failure — только явная retry, серверная идемпотентность сохраняется. Не выдумывать result до успешного response. Пустая/неполная попытка может завершаться при timeout, даже если обычный UI требует все выборы.

### Один локальный таймер
Удалить две цепочки decrement (setInterval + setTimeout). После start success фиксировать абсолютную клиентскую границу из времени запроса старта и time_limit; один scheduler только пересчитывает ceil((localEnd-Date.now())/1000), не уменьшает счётчик на каждом tick. После background/visibilitychange пересчитать; cleanup при unmount/finish; zero вызывает expiry один раз. При отсутствующем/неположительном time_limit таймер не показывать.
Это **приблизительное локальное оставшееся время**, не server accurate: StartAttempt не возвращает started_at/server_now/expires_at, задержка сети/clock skew неизвестны. Использовать понятную подпись/подсказку «Время ориентировочное, ограничение проверяет сервер». Не обещать восстановление после reload. Для строгой синхронизации нужен отдельный backend contract (раздел 8); это не повод блокировать весь UI MVP.

## 5. ENT: подтверждённое и исключённое
handler/ent.go задаёт целевые квоты 10/20/40/40/10, но выборка может вернуть меньше доступных generation_allowed вопросов; проверяется общий zero, а не полнота квот. MaxScore вычисляется по выбранным вопросам. Поэтому 120 вопросов/140 баллов не гарантированы; server 240-minute enforcement в исследованном ENT handler не найден. На prep показываем состав, профильные предметы, без этих фиксированных обещаний и без гарантии соответствия официальному ЕНТ. Из result/start можно показывать фактические count/max, если уже получены существующим flow. Не создавать попытку ради предпросмотра состава.

## 6. Состояния, доступность, адаптивность
По каждому запросу distinguish loading, success empty, no-results от локального фильтра, error/retry, partial error; stale данные допустимы только с явным состоянием обновления, без кеша другого пользователя. Ошибка формы сохраняет ввод; success имеет role=status, ошибка role=alert. Actions имеют label/accessible name; radio в fieldset/legend; неверное поле aria-invalid + aria-describedby; aria-current активной навигации, focus после смены вопроса на heading/legend через focusable wrapper.

Не озвучивать секунды таймера каждую секунду; значимые предупреждения один раз. Полоса вопроса — позиция X/Y, а не % верности/сохранения. Correct/wrong и save states текстом/иконкой, не одним цветом. Skeleton имеет sr-only loading. Тема в продукте остаётся системной prefers-color-scheme; переключатель HTML-прототипа — только инструмент ревью, не новая product настройка/API. Tailwind 4 CSS tokens и media overrides реализовать по релевантным локальным docs, не копировать существующий nested @theme вслепую. Все темы по UX токенам; реальный contrast normal text >=4.5:1, large text/UI focus >=3:1 проверить измерением. 44px touch targets, visible focus, reduced motion.

Ширины 360/768/1440px обязательны, 320px дополнительный stress case. Не закрывать контент fixed nav и soft keyboard. Form/test text max ~760px, desktop container1120px, gutter32/16. Длинные названия переносятся, MathText формулы локально scrollable, вся страница не уезжает horizontally. Диалог только если нужен и существующим Radix; focus trap/return обязателен, inline формы предпочтительны.

## 7. Acceptance / QA matrix
| ID / задачи | Сценарий | Критерий |
|---|---|---|
| AC-01 FE-01/02 | Светлая/тёмная, 360/768/1440; обе роли | Контраст/focus измерены; no overlap/viewport scroll; navigation labels доступны |
| AC-02 FE-03 | Медленные topics, groups error, один group tests error | Ни один error/loading не назван empty; доступные блоки рабочие; partial error виден |
| AC-03 FE-03 | Два group assignment одного test; длинные titles; search miss | Одна карточка test id; titles читаемы; reset search возвращает список |
| AC-04 FE-04 | 0/1/2 profile subjects, history loading/error/empty, start failure | Понятный link profile, нет необъяснимого disabled; нет вымышленных чисел; ввод/состояния сохранены |
| AC-05 FE-05 | Быстрые выборы A→B→C, медленные responses | На вопрос <=1 in-flight; финальный confirmed C; saved не объявлен для A/B |
| AC-06 FE-05 | Failed/ambiguous save, retry, finish во время pending | Нет ложного saved; manual finish не обгоняет writes и не теряет selection; error можно исправить |
| AC-07 FE-05 | Длительная background вкладка, zero, failed pending при expiry | Абсолютный локальный timer без двойного ускорения; one expiry; finish не deadlock; server limit не обходится |
| AC-08 FE-05/09 | Weighted questions, max_score=0, can_see_answers=false, review403/404 | %макс.балла корректно; no NaN; закрытые ответы не появляются/не запрашиваются обходом |
| AC-09 FE-06/07 | Create pending/error/success, public vs published, nullable fields/deadline | No double submit; input остаётся на error; DTO/payload прежний; null/date roundtrip не меняется |
| AC-10 FE-01/08 | Logout/account switch, delayed old response, avatar nonnull/null | Cache не переходит между аккаунтами; refresh/signOut прежние; avatar scalar работает |
| AC-11 FE-01/05 | Keyboard-only, screen-reader labels/status, formulas/long text | Предсказуемый focus, feedback без color-only/частого timer live; content сохраняется |
| AC-12 FE-01/10 | Вне scope: auth, subjects, ENT runner/result, lessons, question/test editors, profiles | Общие tokens/components не ломают существующие формы/actions; новые features не добавлены |

Tester выполняет независимую проверку после frontend, UX — дизайн-ревью. Значимые unit tests для queue/revision/barrier/timeout и timer с fake clock; проверка weighted percent/zero. Для сохранения/таймера используйте задержки/ошибки mock API, не production данные. UI smoke/E2E выполняйте на локальном стенде и специально созданных test accounts. Backend security tests только на disposable test DB, если backend неожиданно менялся.

Команды из frontend: npm run test:security, npm run lint, npm run build. Из корня git diff --check. Не добавлять test tooling dependency без отдельной необходимости. Полный lint ранее имел legacy ошибки; зафиксировать baseline и показать новые/старые отдельно, не объявлять PASS. Исторические security-results результаты не являются текущими. В этом этапе ни команды, ни runtime QA не выполнялись.

## 8. Отдельные backend gaps / не включено в MVP
- Строгий timer: optional контракт start/resume с server started_at/server_now/expires_at; проектируется отдельно. Пока нет точного server clock/resume UI.
- Гарантия latest answer при unknown network outcome: server monotonic revision/idempotency/authoritative GET — отдельная доработка. Клиентская очередь снижает risk, не заменяет серверный протокол.
- Global progress/total/weak topics/recommendation/ranking/notifications/plans/AI/payments не имеют нужного API и не проектируются.
- AddStudent legacy phone против user_id, отсутствующий GET /subtopics в lesson UI — отдельные известные дефекты вне этой итерации; не вводить новые flows. При обнаружении регрессии от общих компонентов исправлять только регрессию.
- Telegram linking остаётся 410; не включать. Question generation только explicit author permission. Access owner/role/deadline и correct answers policy неизменны.
- Никаких миграций, backend endpoint changes, production публикации, массового изменения банка или внешней аналитики.

## 9. Порядок выполнения и handoff
1. Frontend читает AGENTS.md, frontend/AGENTS.md и bundled Next docs; фиксирует working diff и baseline, не перезаписывает текущие security fixes.
2. FE-08 wire types + FE-01 tokens/shell + FE-02 states; build/type integration и smoke обоих layouts.
3. FE-03/04/06/07 реализовать поверх foundations; можно независимыми файлами после фиксации общего UI контракта. Один владелец shared files.
4. FE-05/09 state machine и UX runner; смысловые tests queue/timer/finish, then visual styling. Backend gap не маскировать.
5. FE-10 независимый tester, затем UX review; architect проверяет API/security/acceptance. Исправить новые дефекты и повторить затронутые проверки.
6. Передать список файлов, результаты команд/AC, оставшиеся gaps; не commit/push/deploy без отдельного поручения. Это ТЗ не означает, что реализация/тестирование уже выполнены.

