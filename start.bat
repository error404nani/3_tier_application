@echo off
echo ======================================================================
echo  Starting Three-Tier Task Scheduler with Redis in Docker
echo ======================================================================
echo.

docker compose up --build -d

echo.
echo ======================================================================
echo  All services are up!
echo  Tier 1 Frontend: http://localhost:3000
echo  Tier 2 Backend:  http://localhost:5000/api/health
echo  Tier 3 Redis:    localhost:6379
echo ======================================================================
echo.

start http://localhost:3000
pause
