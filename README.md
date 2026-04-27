# PDF Merger - Full Stack Application

A secure, high-performance web application to merge multiple PDFs into a single document. 

## Architecture

This application is built as a full-stack monorepo:

- **Frontend (`/client`)**: Built with Vanilla JS and Vite. Handles the user interface, drag-and-drop uploads, IndexedDB session persistence, and API communication. Contains no business logic or PDF manipulation code, keeping the client lightweight and secure.
- **Backend (`/server`)**: A Node.js and Express server. Handles file uploads via `multer` (in memory) and uses `pdf-lib` to execute the PDF merging process entirely on the server.

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm

### Installation

1. Install dependencies for the root workspace, frontend, and backend simultaneously:
   ```bash
   npm run install-all
   ```

2. Environment Variables setup:
   - **Backend**: In the `/server` directory, copy `.env.example` to `.env` (the defaults are usually fine).
   - **Frontend**: In the `/client` directory, copy `.env.example` to `.env`. Modify `VITE_API_URL` if your backend is running on a different URL/port.

### Development

Start both the backend and frontend development servers concurrently:

```bash
npm run dev
```

- Frontend runs at: `http://localhost:5173`
- Backend API runs at: `http://localhost:5000/api`

## Deployment

### Backend (Railway, Render, Fly.io, etc.)
1. Create a new Node.js service pointing to the `/server` directory.
2. Set the `PORT` environment variable (e.g. 5000).
3. Set the `CLIENT_URL` environment variable to the deployed frontend URL (for CORS validation).

### Frontend (Vercel, Netlify, Cloudflare Pages, etc.)
1. Create a new static deployment pointing to the `/client` directory.
2. Build command: `npm run build`
3. Output directory: `dist`
4. Set the `VITE_API_URL` environment variable to point to your live deployed backend URL (e.g. `https://your-backend-api.com/api`).

## Security Note

All API keys and business logic are securely isolated in the backend. Sensitive credentials should never be committed to the repository and should only live in the backend's `.env` configuration.
