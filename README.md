# Moneytracer — v4.0 SkyMapper.

This project was generated from `README4.0.md`. It implements the **"Currently Working (v5.0)"**

# 💰 MoneyTracer

**MoneyTracer** is a secure, lightweight, and scalable multi-tenant financial ledger and money management web application. Designed to handle business and personal finance tracking across diverse regions, MoneyTracer provides real-time income/expense tracking, localized multi-language support (Swahili/English), and automated financial reporting.

---

## ✨ Features

* **🏢 Multi-Tenant Architecture:** Isolated workspace environments allowing individual users, small businesses, or multiple shop branches to maintain independent financial ledgers.
* **📊 Comprehensive Financial Ledger:** Real-time tracking of cash flow, daily expenses, sales revenues, and accounts receivable/payable.
* **🌐 Multilingual & Localized:** Built-in localization support for 7 African languages, enabling localized user interface interactions and multi-currency formatting.
* **📈 Automated Analytics & Snapshots:** Generate daily, weekly, and monthly financial summaries and profit/loss breakdowns at a glance.
* **🛡️ Secure Access Control:** Role-based authentication (RBAC) and JWT session handling ensuring workspace data remains strictly private.
* **⚡ Docker & Cloud Ready:** Containerized setup optimized for quick deployment on cloud platforms like Railway or Docker Compose.

---

## 🛠️ Tech Stack

* **Backend:** FastAPI / Python 3.11+
* **Database:** PostgreSQL (with Async SQLAlchemy & Alembic migrations)
* **Frontend:** Responsive HTML5, Tailwind CSS, JavaScript (Alpine.js / Vue.js)
* **Authentication:** OAuth2 with JWT Bearer tokens & Passlib (Bcrypt)
* **Deployment & Ops:** Docker, Docker Compose, Railway

---

## 📁 Repository Structure

```text
Moneytracer/
├── app/
│   ├── api/            # API endpoints & route handlers
│   ├── core/           # Security, auth, config, & database setup
│   ├── models/         # SQLAlchemy database models
│   ├── schemas/        # Pydantic validation schemas
│   ├── services/       # Business logic & financial calculation modules
│   ├── static/         # Static assets (CSS, JS, images)
│   └── templates/      # Localized HTML templates
├── migrations/         # Alembic database migration scripts
├── .env.example        # Environment variable template
├── Dockerfile          # Container build specifications
├── docker-compose.yml  # Local multi-container orchestration
├── requirements.txt    # Python dependencies
└── README.md

```

---

## 🚀 Quick Start Guide

### Prerequisites

* Python 3.11 or higher
* PostgreSQL 15+
* Docker & Docker Compose (optional, for containerized run)

---

### 1. Local Development Setup

1. **Clone the Repository:**
```bash
git clone [https://github.com/zimbermanne/Moneytracer.git](https://github.com/zimbermanne/Moneytracer.git)
cd Moneytracer

```


2. **Create a Virtual Environment:**
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

```


3. **Install Dependencies:**
```bash
pip install -r requirements.txt

```


4. **Environment Configuration:**
Copy the example environment file and configure your local settings:
```bash
cp .env.example .env

```


Set your local database URL and secrets inside `.env`:
```env
PROJECT_NAME="MoneyTracer"
SECRET_KEY="your-super-secret-key"
DATABASE_URL="postgresql+asyncpg://user:password@localhost:5432/moneytracer_db"
DEFAULT_LANGUAGE="ENG"

```


5. **Run Database Migrations:**
```bash
alembic upgrade head

```

6. **Start the Application:**
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

```

Access the web app at `http://localhost:8000` or view API docs at `http://localhost:8000/docs`.

---

### 2. Docker Setup

To run MoneyTracer with PostgreSQL using Docker Compose:

```bash
docker-compose up -d --build

```

## ☁️ Deployment (Railway)

MoneyTracer is configured for seamless deployment on **Railway**:

1. Link your GitHub repository (`zimbermanne/Moneytracer`) to a new Railway project.
2. Add a **PostgreSQL Database** service in Railway.
3. Set your environment variables in Railway:
* `DATABASE_URL` (linked from the Railway Postgres service)
* `SECRET_KEY`
* `ENVIRONMENT=production`


4. Deploy — Railway will detect the `Dockerfile` or Python environment automatically and trigger the build.

---

## 🤝 Contributing

1. Fork the project repository.
2. Create your feature branch (`git checkout -b feature/NewFeature`).
3. Commit your changes (`git commit -m 'Add NewFeature'`).
4. Push to the branch (`git push origin feature/NewFeature`).
5. Open a Pull Request.

---
Got it! That changes the core identity of the platform completely. **MoneyTracer** is purpose-built as an **All-African financial platform**—eliminating western defaults like USD to focus exclusively on intra-African trade, local fiat currencies, and native cross-border commerce across all **54 African nations and languages**.

Here is the updated, deeply tailored **`README.md`**:

---

```markdown
# 🌍 MoneyTracer — Pan-African Financial Ledger

**MoneyTracer** is a lightweight, high-performance multi-tenant financial tracking platform built specifically for the African continent. Designed from the ground up for cross-border trade, regional SMEs, and multi-market enterprise operations, MoneyTracer operates entirely within the African economic ecosystem—featuring **zero USD dependencies**, native support for **54 African national currencies**, and dynamic **54-language African localization**.

---

## 🌍 Pan-African Core Architecture

### 🗣️ 1. 54-Language Localization Engine
MoneyTracer bridges linguistic gaps across northern, sub-Saharan, eastern, western, and southern Africa.
* **Native Language System:** Native translation dictionaries for **54 African languages** (e.g., Kiswahili, Amharic, Hausa, Yoruba, Zulu, Igbo, Oromo, Somali, Shona, Luganda, Lingala, Kinyarwanda, Afrikaans, Berber, Wolof, etc.).
* **Dynamic Regional Dialect Switcher:** Real-time UI rendering based on tenant, branch, or user preference without reloading application state.
* **Localized Numeral & Date Parsing:** Automatic formatting of dates, numbers, and monetary figures according to regional African conventions.

### 💱 2. Intra-African Multi-Currency Engine (100% USD-Free)
MoneyTracer strips away Western currency defaults in favor of direct intra-African cross-border exchange logic.
* **54 African National Currencies:** Native handling for all African legal tender (e.g., TZS, KES, UGX, RWF, ETB, NGN, GHS, ZAR, EGP, MAD, XOF, XAF, BWP, etc.).
* **Direct Intra-African FX Rates:** Direct cross-currency conversions between African markets (e.g., TZS ↔ KES, NGN ↔ GHS) without routing value through intermediary fiat like USD or EUR.
* **Base Currency Standard:** Each workspace/branch locks a primary operational base currency, with automatic real-time FX conversions for regional suppliers or customers.
* **Inflation & Rate Adjustment Logs:** Historical rate tracking to safeguard ledger accuracy against regional currency fluctuations.

---

## 🛠️ System Roles & Functional Architecture

### 👑 Administrator & Owner Functions
Administrative controls designed for business owners, multi-branch operations, and regional group managers:

* **Tenant & Branch Isolation:** Provision separate workspace environments for independent shops, cross-border outlets, or sub-entities.
* **Custom African Currency & FX Controls:** Set workspace base currencies, override exchange rates for cross-border trade, and configure conversion margins.
* **Granular Role-Based Access (RBAC):** Assign custom permissions to Regional Managers, Branch Administrators, Accountants, Store Clerks, and Auditors.
* **Mobile Money & Bank Reconciliations:** Configure tracking for African digital wallets and banking rails (e.g., M-Pesa, Airtel Money, MTN Mobile Money, Tigo Pesa, Orange Money, local bank accounts).
* **Consolidated Financial Statements:** Generate multi-currency P&L reports, Balance Sheets, tax summaries, and exportable ledger data (CSV/Excel).
* **Audit Trail & System Integrity:** Real-time logging of backdated entries, rate adjustments, user activity, and soft-deleted records.

### 💼 Operational & User Functions
Fast, low-friction interfaces built for day-to-day transaction logging:

* **Income & Expense Entry:** Rapid logging for sales, stock procurement, shipping/logistics costs, and daily overheads with receipt attachment support.
* **Receivables & Payables (Debts & Micro-Loans):** Track customer credit, supplier debts, installment payments, and automated settlement reminders.
* **Digital Wallet & Cash Balance Tracking:** Real-time visibility across physical cash drawers, till balances, and mobile money merchant accounts.
* **Custom Category Mapping:** Flexible classification for inventory purchases, customs duties, transport, and operational expenses.

---

## 📁 Repository Structure

```text
Moneytracer/
├── app/
│   ├── api/            # REST API routes and endpoints
│   ├── core/           # Security, authentication, & database engine
│   ├── i18n/           # 54-language African dictionaries & locale configs
│   ├── currencies/     # Intra-African FX engine & conversion logic
│   ├── models/         # SQLAlchemy models (Tenants, Users, Ledgers, FX Rates)
│   ├── schemas/        # Pydantic validation schemas
│   ├── services/       # Core business logic (Ledger, Auth, Admin)
│   ├── static/         # CSS, JS, and UI assets
│   └── templates/      # Localized HTML templates
├── migrations/         # Alembic database migration scripts
├── .env.example        # Environment variable template
├── Dockerfile          # Container setup
├── docker-compose.yml  # Local multi-container orchestration
├── requirements.txt    # Dependencies
└── README.md

```

---

## ⚙️ Environment Configuration

Set up your `.env` file with native African defaults:

```env
# General App Config
PROJECT_NAME="MoneyTracer"
SECRET_KEY="your-super-secret-key"
ENVIRONMENT="production"

# Database Link
DATABASE_URL="postgresql+asyncpg://user:password@localhost:5432/moneytracer_db"

# Pan-African Localization Variables
DEFAULT_LANGUAGE="sw"                 # Default: Kiswahili (or am, ha, yo, zu, etc.)
DEFAULT_BASE_CURRENCY="TZS"           # Primary operational currency (e.g., TZS, KES, NGN, ZAR)
ENABLE_ALL_AFRICAN_CURRENCIES=true    # Enables full 54-currency registry

```

---

## 🚀 Deployment (Railway / Docker)

MoneyTracer is optimized for fast deployment on cloud environments like **Railway**:

1. Connect your repository (`zimbermanne/Moneytracer`) to **Railway**.
2. Provision a **PostgreSQL** database service in Railway.
3. Configure environment variables (`DATABASE_URL`, `SECRET_KEY`, `DEFAULT_BASE_CURRENCY`, `DEFAULT_LANGUAGE`).
4. Railway will automatically detect the `Dockerfile`, build the application, and bring the service online.

---

## 📄 License

Distributed under the **MIT License**. Built for Africa.

```

---

<ElicitationsGroup message="Where would you like to refine next?">
  <Elicitation label="Draft a contribution guide for adding new African language dictionaries" query="Draft a CONTRIBUTING.md section specifically explaining how translators can contribute new JSON/PO translation dictionaries for African languages."/>
  <Elicitation label="Add a technical section detailing the intra-African FX database models" query="Write a technical breakdown of the database schema for handling direct intra-African exchange rates without routing through USD."/>
</ElicitationsGroup>

```
