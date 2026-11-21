# Despliegue en Fly.io

## Requisitos
- Instalar flyctl: https://fly.io/docs/hands-on/install-flyctl/
- Cuenta en Fly.io (free tier)

## Pasos

1. Login:
   ```bash
   fly auth login
   ```

2. Crear la app (si no existe):
   ```bash
   fly apps create ayamonte-org
   ```

3. Crear volumen persistente para SQLite:
   ```bash
   fly volumes create data_vol --region mad --size 1
   ```

4. Configurar secretos (credenciales y sesion):
   ```bash
   fly secrets set ADMIN_USER=Ayamonte
   fly secrets set ADMIN_PASSWORD=Aya21400
   fly secrets set SESSION_SECRET=ayamonte-org-session-secret-key-2026
   ```

5. Desplegar:
   ```bash
   fly deploy
   ```

6. Verificar:
   ```bash
   fly open
   fly logs
   ```

## Scheduler (recopilacion automatica)
La VM queda siempre encendida (min_machines_running=1), por lo que el scheduler interno funciona.
Si prefieres auto-stop para ahorrar horas, configura un cron externo (cron-job.org) que llame a:
`https://ayamonte-org.fly.dev/api/admin/collect` cada 30 min.

## Actualizar
```bash
fly deploy
```

## Backup de la BD
```bash
fly ssh console -C "cat data/ayamonte.db" > backup.db
```
