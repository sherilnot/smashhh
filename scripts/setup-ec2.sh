#!/bin/bash
# Run this ON the EC2 instance after SSH-ing in.
# Usage: bash setup-ec2.sh

set -e

echo "=== Installing Node.js, Git, Nginx, PM2 ==="
sudo dnf update -y
sudo dnf install -y nodejs git nginx

echo "=== Node version ==="
node --version

echo "=== Installing PM2 globally ==="
sudo npm install -g pm2

echo "=== Cloning repository ==="
if [ ! -d "smashhh" ]; then
  read -p "Enter your GitHub repo URL: " REPO_URL
  git clone "$REPO_URL" smashhh
fi

cd smashhh
npm install --production

echo ""
echo "=== Creating .env file ==="
read -p "RDS Endpoint (e.g., smashhh-db.xxxx.ap-southeast-2.rds.amazonaws.com): " DB_HOST
read -p "DB Password: " DB_PASS

cat > .env << EOF
DATABASE_URL=postgresql://postgres:${DB_PASS}@${DB_HOST}:5432/fashionshop
PORT=3000
NODE_ENV=production
SESSION_SECRET=the_onepiece_is_real
VAPID_PUBLIC_KEY=BBeWgxHU4ecGw9ShMCSr_E1EuENetFdL_HumNC-4D9UGzl-_xV55TGI1ndgPGmTW0XNq6I35M92YaaqC6hSAhno
VAPID_PRIVATE_KEY=-bWjBQSgc74_LC3pjRvxdiJHRPawS0lYluripwMLCzs
VAPID_SUBJECT=mailto:admin@yourdomain.com
EOF

echo ""
echo "=== Running database migrations ==="
node scripts/init-db.js
node scripts/seed-data.js

echo ""
echo "=== Starting app with PM2 ==="
pm2 start src/app.js --name smashhh
pm2 startup | tail -1 | bash
pm2 save

echo ""
echo "=== Configuring Nginx ==="
sudo tee /etc/nginx/conf.d/smashhh.conf > /dev/null << 'NGINX'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

sudo systemctl enable nginx
sudo systemctl restart nginx

echo ""
echo "============================================"
echo "  DONE! App is live on port 80"
echo "  Visit: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
echo "============================================"
