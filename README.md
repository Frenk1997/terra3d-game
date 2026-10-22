# 🌍 Terra 3D

Кликер про развитие планет Солнечной системы: 10 эпох Земли, экспедиции на Марс и Юпитер со своими ресурсами,
перками и косметикой, кинематографичные переходы эпох, астероиды, звуки, вход через Google и общий рейтинг игроков.

Всё собирается автоматически на GitHub: вы загружаете эти файлы один раз, а дальше GitHub сам
собирает **APK** и выкладывает **сервер** на Cloudflare после каждого изменения.

```
web/        игра (одна и та же для APK и для сайта) + config.js с адресом сервера
            js/data.js — планеты, эпохи, постройки, перки, косметика; js/game.js — движок; js/sound.js — звуки
android/    оболочка APK (Android-приложение, внутри которого запускается игра)
server/     сервер на Cloudflare: вход через Google, сохранения, рейтинг
.github/    сценарии автосборки: «Build APK» и «Deploy server»
```

**Что получится в итоге**

- APK по постоянной ссылке: `https://github.com/ЛОГИН/terra3d/releases/latest/download/terra3d.apk`
- Сайт с игрой: `https://terra-api.ПОДДОМЕН.workers.dev` (на нём же кнопка «📱 Скачать для Android»)
- Общий рейтинг, облачный прогресс и вход через Google — и в APK, и на сайте

На всё уходит около 30–40 минут. Нужны только браузер и бесплатные аккаунты GitHub, Cloudflare и Google.

---

## Шаг 1. Репозиторий на GitHub

1. Зарегистрируйтесь на [github.com](https://github.com).
2. Справа вверху **+ → New repository**. Имя: `terra3d`. Видимость: **Public** — иначе игроки не смогут скачать APK по ссылке.
   Ключ подписи в репозитории зашифрован, пароль от него хранится только в секретах (шаг 2).
3. Нажмите **Create repository**, затем на странице репозитория ссылку **uploading an existing file**.
4. Распакуйте архив и перетащите в окно **всё содержимое** папки `terra3d`: папки `.github`, `android`, `server`, `web`
   и файлы `README.md`, `.gitignore`. Нажмите **Commit changes**.

> ⚠️ Проверьте, что появилась папка `.github`. На Mac она скрыта: в Finder нажмите **Cmd + Shift + .**, чтобы её увидеть.
> Если папка всё же не загрузилась: **Add file → Create new file**, имя `.github/workflows/android.yml`, вставьте текст
> одноимённого файла из архива, **Commit**. Повторите для `.github/workflows/server.yml`.

## Шаг 2. Пароль ключа подписи и первый APK

1. В репозитории: **Settings → Secrets and variables → Actions → New repository secret**.
2. **Name:** `KEYSTORE_PASSWORD`, **Secret:** пароль, который прислал Claude. **Add secret**.
3. Вкладка **Actions** → слева **Build APK** → **Run workflow**.
4. Через 3–6 минут справа на главной странице репозитория появится **Releases** → `terra3d.apk`.

Пока не сделаны шаги 3–6, это **демо-версия**: играть можно, но без входа и рейтинга. Её уже можно поставить на телефон и посмотреть.

## Шаг 3. Cloudflare (сервер)

1. Зарегистрируйтесь на [dash.cloudflare.com](https://dash.cloudflare.com).
2. В меню слева откройте **Workers & Pages** (раздел Compute). При первом входе Cloudflare попросит выбрать
   **поддомен workers.dev**, например `myname`. Адрес вашего сервера будет `https://terra-api.myname.workers.dev` — запишите его.
3. **Account ID:** на странице Workers & Pages (или на главной странице аккаунта) справа есть **Account ID** → скопируйте.
4. **API-токен:** значок профиля справа вверху → **My Profile → API Tokens → Create Token** →
   шаблон **Edit Cloudflare Workers** → **Use template**. В блоке **Permissions** нажмите **+ Add more** и добавьте
   **Account → D1 → Edit**. **Continue to summary → Create Token** → скопируйте токен (Cloudflare покажет его один раз).

## Шаг 4. Google (вход в игру)

1. Откройте [console.cloud.google.com](https://console.cloud.google.com) и создайте проект **Terra 3D** (выпадающий список проектов вверху → **New project**).
2. Меню **☰ → APIs & Services → OAuth consent screen** (в новой версии раздел называется **Google Auth Platform**) → **Get started**:
   название приложения `Terra 3D`, ваша почта → **Audience: External** → контактная почта → **Create**.
3. Раздел **Audience** → **Publish app** → подтвердите. Статус должен стать **In production**.
   Без этого войти смогут только вручную добавленные тестировщики. Игра запрашивает только идентификатор аккаунта (`openid`),
   поэтому проверка приложения в Google не требуется.
4. Раздел **Clients → Create client**:
   - **Application type:** Web application, **Name:** `Terra`
   - **Authorized redirect URIs → Add URI:** `https://terra-api.ПОДДОМЕН.workers.dev/auth/google/callback`
     (ваш поддомен из шага 3; адрес должен совпадать символ в символ)
   - **Create**
5. Скопируйте **Client ID** и **Client secret**.
   ⚠️ Google показывает секрет только сейчас — сохраните его (можно нажать **Download JSON**).

Отдельный Android-клиент и SHA-1 **не нужны**: в APK вход открывается в браузере телефона и возвращается в игру.

## Шаг 5. Секреты сервера и запуск

Добавьте в **Settings → Secrets and variables → Actions** ещё пять секретов (так же, как в шаге 2):

| Name | Что вставить |
|---|---|
| `CLOUDFLARE_API_TOKEN` | токен из шага 3 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID из шага 3 |
| `GOOGLE_CLIENT_ID` | Client ID из шага 4 |
| `GOOGLE_CLIENT_SECRET` | Client secret из шага 4 |
| `SESSION_SECRET` | строка, которую прислал Claude (или любые 40+ случайных символов) |

Затем **Actions → Deploy server → Run workflow**. Через 1–2 минуты откройте `https://terra-api.ПОДДОМЕН.workers.dev` —
должна открыться игра с кнопкой **«Войти через Google»**. Попробуйте войти.

## Шаг 6. Адрес сервера в APK

1. Откройте в репозитории файл `web/config.js` → значок ✏️.
2. Замените строку адреса на свою:
   ```js
   API_URL: 'https://terra-api.ПОДДОМЕН.workers.dev',
   ```
3. **Commit changes.** GitHub сам соберёт новый APK (в Releases появится следующая версия) и обновит сайт.

## Шаг 7. Раздайте игру

- **Ссылка на APK:** `https://github.com/ЛОГИН/terra3d/releases/latest/download/terra3d.apk` — всегда ведёт на последнюю версию.
- **Или ссылка на сайт:** `https://terra-api.ПОДДОМЕН.workers.dev` — там можно играть в браузере и скачать APK.

Как установить на телефон: открыть скачанный файл → разрешить установку из этого источника → **Установить**.
Play Защита может предупредить о приложении не из Google Play — это обычное дело для APK: **Подробнее → Всё равно установить**.

Новые версии ставятся поверх старых, прогресс сохраняется: он хранится в облаке и на телефоне.

---

## Как вносить изменения

Любая правка в `web/` (через ✏️ на GitHub) → через несколько минут новый APK в Releases и обновлённый сайт.
Номер версии растёт сам.

> ⚠️ Не меняйте и не удаляйте `android/app/release.keystore` и пароль `KEYSTORE_PASSWORD`.
> Если ключ сменится, новые версии не встанут поверх старых — игрокам придётся удалять игру.
> Сохраните пароль где-нибудь ещё, например в менеджере паролей.

## Если что-то не работает

| Что видите | Что сделать |
|---|---|
| Build APK: «Нет пароля ключа» | Шаг 2: секрет `KEYSTORE_PASSWORD` |
| Build APK: «Демо-сборка» | Шаг 6: адрес сервера в `web/config.js` |
| Deploy server: «Сервер не выложен: не заданы секреты …» | Шаг 5: добавьте перечисленные секреты и запустите заново |
| Deploy server: `You need to register a workers.dev subdomain` | Шаг 3.2: выберите поддомен в Workers & Pages |
| Deploy server: ошибка про D1 / `Authentication error` | Шаг 3.4: у токена должны быть права Workers **и** D1 → Edit |
| Google: `Error 400: redirect_uri_mismatch` | Шаг 4.4: адрес `…/auth/google/callback` должен совпадать с вашим поддоменом точно |
| Google: «Доступ заблокирован» / «только для тестировщиков» | Шаг 4.3: **Publish app** |
| В игре: «Сервер ещё не настроен» | Шаг 5: проверьте `GOOGLE_CLIENT_SECRET` и `SESSION_SECRET`, перезапустите Deploy server |
| После входа браузер не возвращает в игру | Нажмите «Вернуться в игру», затем «Открыть другим способом». Проверьте, что стоит последняя версия APK |
| Игроки из России: вход и рейтинг зависают | С июня 2025 российские провайдеры ограничивают Cloudflare. Помогает VPN. Сама игра в APK работает и без сети, прогресс отправится, когда связь появится |

## Как устроен вход (для любопытных)

1. Игра создаёт случайный секрет и отправляет на сервер только его хэш, затем открывает `/auth/google/start`.
2. Сервер перенаправляет на Google (`scope=openid`: почту и имя игра не получает).
3. Google возвращает игрока на `/auth/google/callback`. Сервер проверяет ответ Google и выдаёт одноразовый код.
4. Код возвращается в игру: в APK через ссылку `terra3d://auth`, на сайте через `#auth=…` в адресе.
5. Игра меняет код плюс свой секрет на сессию (`/api/auth/exchange`). Перехватить вход по одной ссылке нельзя: без секрета код бесполезен.

При выходе сессия и локальные данные на устройстве стираются, а при следующем входе Google снова спрашивает, каким аккаунтом войти.

## Ручной деплой без GitHub (необязательно)

Нужен Node.js. В папке репозитория:

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... GOOGLE_CLIENT_ID=... \
GOOGLE_CLIENT_SECRET=... SESSION_SECRET=... bash server/deploy.sh
```

APK можно собрать и в Android Studio: откройте папку `android/`, задайте переменную окружения `KEYSTORE_PASSWORD`
и выполните **Build → Generate APKs** (без пароля APK подпишется отладочным ключом).
