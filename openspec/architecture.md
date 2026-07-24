# Architecture

## Overview
Tareapython is a client-server web application.

- **Frontend:** A Single Page Application (SPA) built with React, Vite, and TypeScript. Uses React Router for navigation, React Query for server state management, and Zustand for global client state.
- **Backend:** A RESTful API built in Rust using the Axum framework. 
- **Database:** PostgreSQL accessed asynchronously using SQLx, managing migrations and typed queries.

## Key Directories
- `source/frontend/`: Contains the React/Vite frontend.
- `source/backend/`: Contains the Rust/Axum backend.
