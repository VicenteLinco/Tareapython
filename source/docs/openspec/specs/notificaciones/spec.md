# Notifications Specification

## Purpose

Provide a system-wide notification center to alert administrators about key events, such as short-expiry reception warnings.

## Requirements

### Requirement: Notification Backend API
The system MUST expose REST endpoints for managing notifications.

| Endpoint | Method | Role Allowed | Description |
| :--- | :--- | :--- | :--- |
| `/api/v1/notificaciones` | GET | `admin` | List notifications (paginated) |
| `/api/v1/notificaciones/conteo` | GET | `admin` | Get count of unread notifications |
| `/api/v1/notificaciones/{id}/leer` | POST | `admin` | Mark a specific notification as read |
| `/api/v1/notificaciones/leer-todas` | POST | `admin` | Mark all notifications as read |
| `/api/v1/notificaciones/clear` | DELETE | `admin` | Clear all notifications for the user |

#### Scenario: Administrator fetches unread count
- GIVEN an authenticated user with `admin` role has 3 unread notifications
- WHEN the user requests `GET /api/v1/notificaciones/conteo`
- THEN the system MUST return a count of 3 with HTTP status 200

#### Scenario: Non-admin access rejected
- GIVEN an authenticated user without `admin` role
- WHEN the user requests any notification endpoint
- THEN the system MUST return HTTP status 403 Forbidden

### Requirement: UI Notification Bell
The frontend header MUST display a notification bell icon with an unread badge, accessible only to the `admin` role.

#### Scenario: Bell displays notification list
- GIVEN the logged-in user is an `admin` and clicks the notification bell
- WHEN the list is populated
- THEN the UI MUST display the unread notifications list with an option to mark them as read or clear all
