#!/bin/bash


RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║       Command Center - Deployment Validation              ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

ERRORS=0

log_check() {
    echo -ne "${YELLOW}[CHECK]${NC} $1... "
}

log_pass() {
    echo -e "${GREEN}PASSED${NC}"
}

log_fail() {
    echo -e "${RED}FAILED${NC}"
    ERRORS=$((ERRORS+1))
}

log_check "Container Durumları"
if docker compose ps --services --filter "status=running" | grep -q "backend" && \
   docker compose ps --services --filter "status=running" | grep -q "nginx" && \
   docker compose ps --services --filter "status=running" | grep -q "postgres" && \
   docker compose ps --services --filter "status=running" | grep -q "minio"; then
    log_pass
else
    log_fail
    echo "  -> Bazı container'lar çalışmıyor. 'docker compose ps' ile kontrol edin."
fi

log_check "Port Dinleme (HTTP/80)"
if netstat -tuln | grep -q ":80 "; then log_pass; else log_fail; echo "  -> Port 80 kapalı."; fi

log_check "Port Dinleme (HTTPS/443)"
if netstat -tuln | grep -q ":443 "; then log_pass; else log_fail; echo "  -> Port 443 kapalı."; fi

log_check "Port Dinleme (MQTT/8883)"
if netstat -tuln | grep -q ":8883 "; then log_pass; else log_fail; echo "  -> Port 8883 kapalı."; fi

log_check "Backend API Health (/api/health)"
if curl -k -s -f https://localhost/api/health > /dev/null; then
    log_pass
else
    if curl -s -f http://localhost/api/health > /dev/null; then 
        log_pass
        echo "  (HTTP üzerinden erişildi)"
    else
        log_fail
        echo "  -> API yanıt vermiyor."
    fi
fi

log_check "PostgreSQL Bağlantısı"
if docker compose exec postgres pg_isready -U postgres > /dev/null; then
    log_pass
else
    log_fail
    echo "  -> Veritabanı hazır değil."
fi

log_check "MinIO Bucket'ları"
if docker compose exec minio ls -l /data/images > /dev/null 2>&1 && \
   docker compose exec minio ls -l /data/logs > /dev/null 2>&1; then
    log_pass
else
    log_fail
    echo "  -> 'images' veya 'logs' bucket klasörleri diskte bulunamadı."
fi

log_check "Dashboard Erişimi"
if curl -k -s -I https://localhost | grep -q "200 OK\|301 Moved"; then
    log_pass
else
    log_fail
    echo "  -> Dashboard response kodu 200 veya 301 değil."
fi

echo ""
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN} TÜM TESTLER BAŞARILI! SİSTEM KULLANIMA HAZIR. ${NC}"
    exit 0
else
    echo -e "${RED} TOPLAM $ERRORS HATALI DURUM VAR. LOGLARI KONTROL EDİN. ${NC}"
    exit 1
fi
