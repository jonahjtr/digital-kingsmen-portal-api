# Digital Kingsmen Portal API

API backend for the Digital Kingsmen client portal.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your configuration
npm run dev
```

## Scripts

- `npm start` - Run production server
- `npm run dev` - Run development server with nodemon

## Structure

```
├── index.js          # Entry point
├── routes/           # API routes
├── models/           # Data models
├── middleware/       # Express middleware
├── utils/            # Utility functions
└── config/           # Configuration files
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | /        | API info |
| GET    | /health  | Health check |
