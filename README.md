# Backend Repository

## Purpose

This repository contains the Express backend for the jewelry project.

## Local setup

1. Copy `.env.example` to `.env`
2. Install dependencies:

```bash
npm install
```

3. Run the development server:

```bash
npm run dev
```

## Azure deployment

This repository is prepared for Azure App Service with GitHub Actions.

### Required GitHub secrets

- `AZURE_BACKEND_APP_NAME`
- `AZURE_BACKEND_PUBLISH_PROFILE`

### Required Azure App Settings

Set your production environment variables in Azure App Service.
Do not commit `.env`.

If you are deploying on Azure, start from `.env.azure.example`.

Important production notes:

- Set `NODE_ENV=production`
- Set `DB_ENCRYPT=true`
- Set `DB_TRUST_SERVER_CERTIFICATE=false`
- Set `SEPAY_WEBHOOK_REQUIRE_SECRET=true`
- Set `MONGODB_SEPAY_SYNC_ENABLED=false` if you only use SQL Server
- Replace all real secrets before going live

### Workflow

The GitHub Actions workflow is stored in:

- `.github/workflows/deploy-azure-webapp.yml`

It deploys the `main` branch to Azure App Service.

## Git notes

- Commit source code, `package.json`, `package-lock.json`, docs, and `.env.example`
- Do not commit `.env`, `uploads/`, `node_modules/`, or log files

## Known production concern

The current code still saves some images into `uploads/`.
If you keep this behavior, use persistent storage on Azure.
If you do not want local-style image storage, move image uploads to Azure Blob Storage before production.
