# Moneytracer — v4.0 SkyMapper.

This project was generated from `README4.0.md`. It implements the **"Currently Working (v5.0)"**

# 💰 MoneyTracer

**MoneyTracer** is a secure, lightweight, and scalable multi-tenant financial ledger and money management web application. Designed to handle business and personal finance tracking across diverse regions, MoneyTracer provides real-time income/expense tracking, localized multi-language support (Swahili/English), and automated financial reporting.

---

## ✨ Features

* **🏢 Multi-Tenant Architecture:** Isolated workspace environments allowing individual users, small businesses, or multiple shop branches to maintain independent financial ledgers.
* **📊 Comprehensive Financial Ledger:** Real-time tracking of cash flow, daily expenses, sales revenues, and accounts receivable/payable.
* **🌐 Multilingual & Localized:** Built-in localization support for Swahili (`sw`) and English (`en`), enabling localized user interface interactions and multi-currency formatting.
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
DEFAULT_LANGUAGE="sw"

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

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for details.

```

```
