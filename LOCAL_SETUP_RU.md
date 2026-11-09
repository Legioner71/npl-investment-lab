Актуальный маршрут версии 0.9 описан в PIPELINE_RU.md. Команды прежних отдельных CLI ниже относятся к соответствующим модулям.

# Локальный запуск и Python

## 1. Только интерфейс — без ML-установки

Windows: распакуйте ZIP и запустите `START_WINDOWS.bat`. Нужен Python 3.10 или новее. Для командной строки:

```bash
python run_local.py
```

Другой порт и запуск без автоматического открытия браузера:

```bash
python run_local.py --port 8010 --no-browser
```

Сервер печатает адрес `http://127.0.0.1:ПОРТ/`. Он раздаёт только `dist/`. Вход в учётную запись не требуется. Сохранённое сравнение с TabPFN можно смотреть без установки нейросети. Browser imports обрабатываются локально, без ML API.

## 2. Оценка и базовый скоринг — стандартная библиотека

Команды выполняйте из корня проекта. `outputs/` создайте заранее:

```bash
python -c "from pathlib import Path; Path('outputs').mkdir(exist_ok=True)"
python python/valuation.py dist/demo-register.csv --price 3190000 --annual-return 0.60 --cost-rate 0.08
python python/prepurchase.py score dist/prepurchase-model.json dist/prepurchase-case.json --output outputs/base-scores.json
```

Эти команды не требуют numpy или scikit-learn: коэффициенты базовой модели уже экспортированы в JSON.

Для построения стратегии по этому прогнозу нужен Node.js в PATH:

```bash
node --version
python python/strategy.py dist/prepurchase-case.json dist/strategy-operations.json outputs/base-scores.json --output outputs/strategy-plans.json
```

Выход содержит три варианта. Все формулы стратегии выполняются одним общим JS-ядром, используемым и браузером.

## 3. Перенавчить базовую модель

Windows: запустите `SETUP_BASE_ML_WINDOWS.bat`. Он использует Python 3.12 и создаёт `.venv-base` только в этой папке.

Затем, без активации PowerShell-окружения:

```powershell
.venv-base\Scripts\python.exe python/prepurchase.py train dist/prepurchase-history.json --model outputs/new-base-model.json --report outputs/new-base-validation.json
.venv-base\Scripts\python.exe python/prepurchase.py score outputs/new-base-model.json dist/prepurchase-case.json --output outputs/new-base-scores.json
```

Linux/macOS:

```bash
python3.12 -m venv .venv-base
.venv-base/bin/python -m pip install -r requirements-base.txt
.venv-base/bin/python python/prepurchase.py train dist/prepurchase-history.json --model outputs/new-base-model.json --report outputs/new-base-validation.json
```

Окружение: numpy 2.3.5, scikit-learn 1.8.0, scipy 1.17.0. Входные синтетические файлы не изменяйте, если хотите сохранить исходное воспроизводимое демо. Новые результаты пишите в `outputs/`.

## 4. CatBoost и TabPFN

Windows: запустите `SETUP_BENCHMARK_WINDOWS.bat`. Нужны Python 3.12, доступ в интернет и свободное место для PyTorch, зависимостей и весов. Это отдельная `.venv-benchmark`; базовое окружение не меняется. Ставится CPU-вариант PyTorch; NVIDIA-видеокарта не обязательна.

Подготовка и проверка точных весов TabPFN v2:

```powershell
.venv-benchmark\Scripts\python.exe scripts/prepare_tabpfn.py
```

SDK скачивает официальные публичные веса v2, если их нет, и проверяет SHA256 из `dist/model-bundle.json`. Используются версии пакетов из `requirements-benchmark.txt`, а не новые gated-веса. Авторизация в ML API не нужна. Телеметрия TabPFN отключается кодом benchmark. Веса кешируются в папке `.cache/tabpfn` внутри домашней папки пользователя; в Git они не добавляются.

Новый прогноз сохранённой моделью — без нового выбора алгоритма:

```powershell
.venv-benchmark\Scripts\python.exe python/model_benchmark.py score dist/model-bundle.json dist/prepurchase-case.json --model catboost --output outputs/catboost-scores.json
.venv-benchmark\Scripts\python.exe python/model_benchmark.py score dist/model-bundle.json dist/prepurchase-case.json --model tabpfn --output outputs/tabpfn-scores.json
python python/strategy.py dist/prepurchase-case.json dist/strategy-operations.json outputs/tabpfn-scores.json --output outputs/tabpfn-plans.json
```

Полностью повторить эксперимент сравнения:

```powershell
.venv-benchmark\Scripts\python.exe python/model_benchmark.py run dist/benchmark-history.json dist/prepurchase-case.json --report outputs/model-comparison.json --bundle outputs/model-bundle.json
```

Linux/macOS: создайте окружение и используйте `.venv-benchmark/bin/python` вместо Windows-пути:

```bash
python3.12 -m venv .venv-benchmark
.venv-benchmark/bin/python -m pip install torch==2.9.1 --index-url https://download.pytorch.org/whl/cpu
.venv-benchmark/bin/python -m pip install -r requirements-benchmark.txt
.venv-benchmark/bin/python scripts/prepare_tabpfn.py
```

На платформах без колеса PyTorch для указанного CPU-индекса используйте совместимую установку PyTorch из официального дистрибутива; локальные Windows-инструкции рассчитаны на обычную x64-систему. При обновлении версий потребуется новая проверка воспроизводимости.

## 5. Тесты

Установите Node.js для JS-тестов и Python-входа стратегии. Из корня проекта:

```bash
node tests/test_csv.js
node tests/test_strategy.js
python -m unittest discover -s tests -p test_local_server.py -v
```

В базовом окружении выполните полный набор:

```powershell
.venv-base\Scripts\python.exe -m unittest discover -s tests -v
```

В этом окружении тесты benchmark ожидаемо пропускаются, если CatBoost и TabPFN не установлены. Их запускают отдельно:

```powershell
.venv-benchmark\Scripts\python.exe -m unittest discover -s tests -p test_model_benchmark.py -v
```

Для повторного обучения базовой модели используйте отдельное base-окружение: в benchmark установлен scikit-learn 1.6.1, а исходная модель v0.3 обучена с 1.8.0. Побитового совпадения заново обученных коэффициентов между разными платформами и версиями библиотек не обещаем. Проверка отсутствия утечки тестовых целей сравнивает два обучения в одном окружении.

## 6. Собственные данные

- Оценка портфеля принимает CSV из примера `dist/demo-register.csv`.
- Прогноз до покупки принимает JSON из примера `dist/prepurchase-case.json`.
- Стратегия принимает JSON `case` + `operations`, как в `dist/strategy-input-demo.json`.
- Для обучения нужна полная история наблюдений и платежей по схеме `PREPURCHASE_SCHEMA.md`.

Локальный импорт не перенавчает модели. Для реального применения нужны история компании, адаптация полей, проверка правил, бюджета и точности. На демонстрационной синтетической модели нельзя подтверждать инвестиционные решения.

## 7. Частые ситуации

- **Окно BAT сразу закрывается:** запустите из уже открытого CMD; проверьте `py -3 --version` или `python --version`.
- **Ошибка чтения JSON:** не открывайте HTML как файл; используйте `START_WINDOWS.bat` / `run_local.py`.
- **Порт 8000 занят:** launcher выберет другой и напечатает точный адрес; открывайте именно его.
- **Факт исчез после обновления страницы:** сохраните JSON перед закрытием; в пилоте нет базы данных.
- **Видны старые результаты:** новые Python-файлы из `outputs/` не подключаются к интерфейсу автоматически. Для статического показа обновите соответствующие артефакты в `dist/` только после проверки.
- **Не сохраняется HTML:** используйте проверенные JSON/CSV или вывод отчёта через «Друк / PDF» в своём браузере.


Монте-Карло работает в браузере через Web Worker, офлайн после локального запуска; Node и GPU для интерфейса не нужны. Python CLI в `python/monte_carlo.py` опционален и требует Node.js.
