#!/bin/bash

set -e  

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' 

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║       Command Center - Production Kurulum Scripti         ║"
echo "║                                            ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

if [ "$EUID" -ne 0 ]; then
    log_error "Bu script root olarak çalıştırılmalı!"
    log_info "Kullanım: sudo bash install.sh"
    exit 1
fi

INSTALL_DIR="/opt/command-center"
DASHBOARD_DIR="/opt/dashboard"
LOG_DIR="/var/log/command-center"
MINIO_DATA="/data/minio"
BACKUP_DIR="/backup"

DEFAULT_DB_NAME="command_center"
DEFAULT_DB_USER="postgres"
SERVER_DOMAIN="command-dashboard.roboteye.ai"
MASTER_PASSWORD="TurkAI2026"
USE_LETSENCRYPT="y"
SSL_EMAIL="furkan.cam@turkai.com"
DB_PASSWORD="${MASTER_PASSWORD}_db"
MINIO_PASSWORD="${MASTER_PASSWORD}_minio"
CC_MQTT_PASSWORD="TurkAI"
HUB_MQTT_PASSWORD="TurkAI"
MQTT_USERNAME_CC="TurkAI"
MQTT_USERNAME_HUB="TurkAI"

JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRE_MINUTES=10080
JWT_REFRESH_EXPIRE_DAYS=30

echo ""
echo "========================================"
log_info "Kurulum Özeti:"
echo "  - Sunucu: $SERVER_DOMAIN"
echo "  - SSL: Let's Encrypt"
echo "  - Email: $SSL_EMAIL"
echo "========================================"
echo ""
log_info "Kurulum otomatik olarak başlıyor..."
sleep 3

log_info "1/12 - Sistem güncelleniyor ve paketler kuruluyor..."

apt update && apt upgrade -y

apt install -y \
    curl \
    wget \
    git \
    build-essential \
    software-properties-common \
    python3 \
    python3-pip \
    python3-venv \
    nginx \
    postgresql \
    postgresql-contrib \
    mosquitto \
    mosquitto-clients \
    openssl \
    ufw \
    logrotate

if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt install -y nodejs
fi

log_success "Paketler kuruldu"

log_info "2/12 - Kullanıcı ve dizinler oluşturuluyor..."

id -u command-center &>/dev/null || useradd -r -s /bin/false command-center

mkdir -p $INSTALL_DIR
mkdir -p $DASHBOARD_DIR
mkdir -p $LOG_DIR
mkdir -p $MINIO_DATA
mkdir -p $BACKUP_DIR
mkdir -p /etc/mosquitto/certs

log_info "Kod dosyaları $INSTALL_DIR dizinine kopyalanıyor..."
cp -r ./* $INSTALL_DIR/

if [ -d "dist" ]; then
    log_info "📦 Dashboard dist dosyaları bulundu, kopyalanıyor..."
    cp -r dist/* $DASHBOARD_DIR/
else
    log_warning "Dashboard 'dist' klasörü bulunamadı! Build alıp manuel kopyalamalısınız."
fi

chown -R command-center:command-center $INSTALL_DIR
chown -R command-center:command-center $LOG_DIR
chown -R command-center:command-center $MINIO_DATA
chown -R command-center:command-center $DASHBOARD_DIR

log_success "Dosyalar kopyalandı ve izinler ayarlandı"

log_info "3/12 - PostgreSQL yapılandırılıyor..."

systemctl enable postgresql
systemctl start postgresql

sudo -u postgres psql -c "DROP DATABASE IF EXISTS $DEFAULT_DB_NAME;" 2>/dev/null || true
sudo -u postgres psql -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DEFAULT_DB_USER') THEN CREATE ROLE $DEFAULT_DB_USER LOGIN PASSWORD '$DB_PASSWORD'; ELSE ALTER ROLE $DEFAULT_DB_USER WITH PASSWORD '$DB_PASSWORD'; END IF; END \$\$;"
sudo -u postgres psql -c "CREATE DATABASE $DEFAULT_DB_NAME OWNER $DEFAULT_DB_USER;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DEFAULT_DB_NAME TO $DEFAULT_DB_USER;"

if [ -f "$INSTALL_DIR/Database/init.sql" ]; then
    sudo -u postgres psql -d $DEFAULT_DB_NAME -f "$INSTALL_DIR/Database/init.sql"
    log_success "Veritabanı şeması yüklendi"
else
    log_warning "init.sql bulunamadı ($INSTALL_DIR/Database/init.sql), şema yüklenemedi!"
fi

log_success "PostgreSQL yapılandırıldı"

log_info "4/12 - MinIO kuruluyor..."

if [ ! -f /usr/local/bin/minio ]; then
    wget -q https://dl.min.io/server/minio/release/linux-amd64/minio -O /usr/local/bin/minio
    chmod +x /usr/local/bin/minio
fi

if [ ! -f /usr/local/bin/mc ]; then
    wget -q https://dl.min.io/client/mc/release/linux-amd64/mc -O /usr/local/bin/mc
    chmod +x /usr/local/bin/mc
fi

cat > /etc/systemd/system/minio.service << EOF
[Unit]
Description=MinIO Object Storage
After=network.target

[Service]
Type=simple
User=command-center
Group=command-center
Environment="MINIO_ROOT_USER=minioadmin"
Environment="MINIO_ROOT_PASSWORD=$MINIO_PASSWORD"
ExecStart=/usr/local/bin/minio server $MINIO_DATA --console-address ":9001"
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable minio
systemctl start minio

sleep 5
mc alias set local http://localhost:9000 minioadmin "$MINIO_PASSWORD" 2>/dev/null || true
mc mb local/images 2>/dev/null || true
mc mb local/logs 2>/dev/null || true
mc mb local/processed 2>/dev/null || true
mc mb local/data-lake 2>/dev/null || true

log_success "MinIO kuruldu"

log_info "5/12 - TLS sertifikaları (Internal MQTT) oluşturuluyor..."

cd /etc/mosquitto/certs

openssl genrsa -out ca.key 2048
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt \
    -subj "/C=TR/ST=Istanbul/L=Istanbul/O=Turkai/OU=IoT/CN=MQTT-CA"

cat > san.cnf << EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C = TR
ST = Istanbul
L = Istanbul
O = Turkai
OU = IoT
CN = $SERVER_DOMAIN

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = $SERVER_DOMAIN
DNS.2 = localhost
IP.1 = 127.0.0.1
EOF

openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -config san.cnf
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
    -CAcreateserial -out server.crt -days 3650 \
    -extensions v3_req -extfile san.cnf

chown mosquitto:mosquitto /etc/mosquitto/certs/*
chmod 600 /etc/mosquitto/certs/*.key
chmod 644 /etc/mosquitto/certs/*.crt

log_success "TLS sertifikaları oluşturuldu"

log_info "6/12 - Mosquitto yapılandırılıyor..."

touch /etc/mosquitto/passwd
mosquitto_passwd -b /etc/mosquitto/passwd TurkAI "$CC_MQTT_PASSWORD"

chown mosquitto:mosquitto /etc/mosquitto/passwd
chmod 600 /etc/mosquitto/passwd

cat > /etc/mosquitto/acl << EOF
user TurkAI
topic readwrite #
EOF

cat > /etc/mosquitto/mosquitto.conf << EOF
pid_file /run/mosquitto/mosquitto.pid
persistence true
persistence_location /var/lib/mosquitto/

log_dest file /var/log/mosquitto/mosquitto.log
log_type error
log_type warning
log_type notice
log_type information
log_timestamp true

listener 8883 0.0.0.0
protocol mqtt
cafile /etc/mosquitto/certs/ca.crt
certfile /etc/mosquitto/certs/server.crt
keyfile /etc/mosquitto/certs/server.key
tls_version tlsv1.2
require_certificate false

listener 1883 127.0.0.1
protocol mqtt
allow_anonymous false

password_file /etc/mosquitto/passwd
acl_file /etc/mosquitto/acl

max_inflight_messages 20
max_queued_messages 10000
autosave_interval 300
EOF

systemctl enable mosquitto
systemctl restart mosquitto

log_success "Mosquitto yapılandırıldı"

log_info "7/12 - Python environment kuruluyor..."

cd $INSTALL_DIR

python3 -m venv venv
chown -R command-center:command-center venv

if [ -f "requirements.txt" ]; then
    sudo -u command-center ./venv/bin/pip install --upgrade pip
    sudo -u command-center ./venv/bin/pip install -r requirements.txt
    log_success "Python bağımlılıkları yüklendi"
else
    log_warning "requirements.txt bulunamadı"
fi

cat > $INSTALL_DIR/.env << EOF
ENVIRONMENT=production
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DEFAULT_DB_NAME
DB_USER=$DEFAULT_DB_USER
DB_PASSWORD=$DB_PASSWORD

MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=$MINIO_PASSWORD
MINIO_BUCKET_IMAGES=images
MINIO_BUCKET_LOGS=logs
MINIO_SECURE=false

JWT_SECRET_KEY=$JWT_SECRET
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=$JWT_EXPIRE_MINUTES
JWT_REFRESH_EXPIRE_DAYS=$JWT_REFRESH_EXPIRE_DAYS

MQTT_BROKER=127.0.0.1
MQTT_PORT=1883
MQTT_KEEPALIVE=60
MQTT_USERNAME=TurkAI
MQTT_PASSWORD=TurkAI
MQTT_TLS_ENABLED=false
MQTT_TLS_CA_CERT=
MQTT_TLS_INSECURE=false

API_HOST=0.0.0.0
API_PORT=8000
DEBUG=false

CORS_ORIGINS=https://$SERVER_DOMAIN,http://localhost:3000
EOF

chown command-center:command-center $INSTALL_DIR/.env
chmod 600 $INSTALL_DIR/.env

log_success "Python environment kuruldu"

log_info "8/12 - Systemd servisleri oluşturuluyor..."

cat > /etc/systemd/system/command-center.service << EOF
[Unit]
Description=Command Center API
After=network.target postgresql.service mosquitto.service minio.service
Requires=postgresql.service mosquitto.service minio.service

[Service]
Type=simple
User=command-center
Group=command-center
WorkingDirectory=$INSTALL_DIR
Environment="PATH=$INSTALL_DIR/venv/bin"
ExecStart=$INSTALL_DIR/venv/bin/python app.py
Restart=always
RestartSec=10
StandardOutput=append:$LOG_DIR/api.log
StandardError=append:$LOG_DIR/api-error.log

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/mqtt-receiver.service << EOF
[Unit]
Description=Command Center MQTT Receiver
After=network.target mosquitto.service command-center.service
Requires=mosquitto.service

[Service]
Type=simple
User=command-center
Group=command-center
WorkingDirectory=$INSTALL_DIR
Environment="PATH=$INSTALL_DIR/venv/bin"
ExecStart=$INSTALL_DIR/venv/bin/python mqtt/mqtt_receiver.py
Restart=always
RestartSec=10
StandardOutput=append:$LOG_DIR/mqtt-receiver.log
StandardError=append:$LOG_DIR/mqtt-receiver-error.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable command-center
systemctl enable mqtt-receiver

log_success "Systemd servisleri oluşturuldu"

log_info "9/12 - Nginx yapılandırılıyor..."

if [[ "$USE_LETSENCRYPT" != "y" ]]; then
    mkdir -p /etc/nginx/ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/nginx.key \
        -out /etc/nginx/ssl/nginx.crt \
        -subj "/CN=$SERVER_DOMAIN"
fi

cat > /etc/nginx/sites-available/command-center << EOF
server {
    listen 80;
    server_name $SERVER_DOMAIN;
    
    root $DASHBOARD_DIR;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:8000/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/command-center /etc/nginx/sites-enabled/

nginx -t
systemctl enable nginx
systemctl restart nginx

if [[ "$USE_LETSENCRYPT" == "y" ]]; then
    log_info "10/12 - Let's Encrypt sertifikası alınıyor..."
    
    apt install -y certbot python3-certbot-nginx
  
    certbot --nginx -d $SERVER_DOMAIN --non-interactive --agree-tos -m $SSL_EMAIL --redirect
    
    log_success "Let's Encrypt sertifikası alındı ve Nginx güncellendi"
else
    log_info "10/12 - Self-signed SSL yapılandırması..."
   
    
fi

log_info "11/12 - Firewall yapılandırılıyor..."

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

ufw allow 22/tcp comment "SSH"
ufw allow 80/tcp comment "HTTP"
ufw allow 443/tcp comment "HTTPS"
ufw allow 8883/tcp comment "MQTT TLS"

ufw --force enable

log_success "Firewall yapılandırıldı"

log_info "12/12 - Log rotation yapılandırılıyor..."

cat > /etc/logrotate.d/command-center << EOF
$LOG_DIR/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 command-center command-center
    sharedscripts
    postrotate
        systemctl reload command-center >/dev/null 2>&1 || true
    endscript
}
EOF

log_success "Log rotation yapılandırıldı"

log_info "Servisler başlatılıyor..."

systemctl start command-center || log_warning "Command Center başlatılamadı"
systemctl start mqtt-receiver || log_warning "MQTT Receiver başlatılamadı"

echo ""
echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║            Kurulum Başarıyla Tamamlandı!                  ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo " Kurulum Özeti:"
echo "========================================"
echo ""
echo " Sunucu Bilgileri:"
echo "   - Domain: $SERVER_DOMAIN"
echo "   - Dashboard: https://$SERVER_DOMAIN"
echo ""
echo " MQTT Kullanıcıları:"
echo "   - Username: TurkAI"
echo "   - Password: TurkAI (Command Center & Hub)"
echo ""
echo " Hub .env.local Konfigürasyonu:"
echo "   ─────────────────────────────────────────────"
echo "   MQTT_BROKER=$SERVER_DOMAIN"
echo "   MQTT_PORT=8883"
echo "   MQTT_USERNAME=TurkAI"
echo "   MQTT_PASSWORD=TurkAI"
echo "   MQTT_TLS_ENABLED=true"
echo "   MQTT_TLS_INSECURE=true"
echo "   ─────────────────────────────────────────────"
echo ""
echo " Bu bilgileri güvenli bir yerde saklayın!"
echo ""

cat > /root/command-center-credentials.txt << EOF
Domain: $SERVER_DOMAIN

PostgreSQL:
  User: $DEFAULT_DB_USER
  Password: $DB_PASSWORD

MinIO:
  User: minioadmin
  Password: $MINIO_PASSWORD

MQTT:
  Username: TurkAI
  Password: TurkAI

JWT Secret: $JWT_SECRET
EOF

chmod 600 /root/command-center-credentials.txt
log_success "Kurulum tamamlandı!"
