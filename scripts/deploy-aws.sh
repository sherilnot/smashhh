#!/bin/bash
# Automated AWS Free Tier deployment for Smashhh
# Region: ap-southeast-2 (Sydney)
set -e

APP_NAME="smashhh"
REGION="ap-southeast-2"
DB_PASSWORD="Rizins2026Smash!"
DB_NAME="fashionshop"
DB_USER="postgres"
KEY_NAME="smashhh-key"
KEY_FILE="$HOME/.ssh/smashhh-key.pem"

echo "============================================"
echo "  Deploying $APP_NAME to AWS (Sydney)"
echo "============================================"
echo ""

# ─── Step 1: Get default VPC ─────────────────────────────────────────────────
echo "[1/7] Getting default VPC..."
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query 'Vpcs[0].VpcId' --output text --region $REGION)
if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
  echo "Creating default VPC..."
  aws ec2 create-default-vpc --region $REGION 2>/dev/null || true
  VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query 'Vpcs[0].VpcId' --output text --region $REGION)
fi
echo "  VPC: $VPC_ID"

# Get subnets
SUBNETS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets[*].SubnetId' --output text --region $REGION)
SUBNET_1=$(echo $SUBNETS | awk '{print $1}')
SUBNET_2=$(echo $SUBNETS | awk '{print $2}')
echo "  Subnets: $SUBNET_1, $SUBNET_2"

# ─── Step 2: Security Groups ─────────────────────────────────────────────────
echo ""
echo "[2/7] Creating security groups..."

# App security group
APP_SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${APP_NAME}-app-sg" "Name=vpc-id,Values=$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text --region $REGION 2>/dev/null)
if [ "$APP_SG_ID" = "None" ] || [ -z "$APP_SG_ID" ]; then
  APP_SG_ID=$(aws ec2 create-security-group --group-name "${APP_NAME}-app-sg" --description "Smashhh app SG" --vpc-id $VPC_ID --query 'GroupId' --output text --region $REGION)
  aws ec2 authorize-security-group-ingress --group-id $APP_SG_ID --protocol tcp --port 22 --cidr 0.0.0.0/0 --region $REGION 2>/dev/null || true
  aws ec2 authorize-security-group-ingress --group-id $APP_SG_ID --protocol tcp --port 80 --cidr 0.0.0.0/0 --region $REGION 2>/dev/null || true
  aws ec2 authorize-security-group-ingress --group-id $APP_SG_ID --protocol tcp --port 443 --cidr 0.0.0.0/0 --region $REGION 2>/dev/null || true
fi
echo "  App SG: $APP_SG_ID"

# DB security group
DB_SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${APP_NAME}-db-sg" "Name=vpc-id,Values=$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text --region $REGION 2>/dev/null)
if [ "$DB_SG_ID" = "None" ] || [ -z "$DB_SG_ID" ]; then
  DB_SG_ID=$(aws ec2 create-security-group --group-name "${APP_NAME}-db-sg" --description "Smashhh DB SG" --vpc-id $VPC_ID --query 'GroupId' --output text --region $REGION)
  aws ec2 authorize-security-group-ingress --group-id $DB_SG_ID --protocol tcp --port 5432 --source-group $APP_SG_ID --region $REGION 2>/dev/null || true
  # Also allow from your IP for initial setup
  aws ec2 authorize-security-group-ingress --group-id $DB_SG_ID --protocol tcp --port 5432 --cidr 0.0.0.0/0 --region $REGION 2>/dev/null || true
fi
echo "  DB SG: $DB_SG_ID"

# ─── Step 3: Create RDS subnet group ─────────────────────────────────────────
echo ""
echo "[3/7] Creating RDS PostgreSQL (free tier)..."

aws rds create-db-subnet-group \
  --db-subnet-group-name "${APP_NAME}-subnet-group" \
  --db-subnet-group-description "Smashhh DB subnets" \
  --subnet-ids $SUBNET_1 $SUBNET_2 \
  --region $REGION 2>/dev/null || true

# Check if DB already exists
DB_STATUS=$(aws rds describe-db-instances --db-instance-identifier "${APP_NAME}-db" --query 'DBInstances[0].DBInstanceStatus' --output text --region $REGION 2>/dev/null || echo "NOT_FOUND")

if [ "$DB_STATUS" = "NOT_FOUND" ]; then
  aws rds create-db-instance \
    --db-instance-identifier "${APP_NAME}-db" \
    --db-instance-class db.t3.micro \
    --engine postgres \
    --engine-version 15 \
    --master-username $DB_USER \
    --master-user-password "$DB_PASSWORD" \
    --allocated-storage 20 \
    --db-name $DB_NAME \
    --vpc-security-group-ids $DB_SG_ID \
    --db-subnet-group-name "${APP_NAME}-subnet-group" \
    --publicly-accessible \
    --no-multi-az \
    --storage-type gp2 \
    --backup-retention-period 0 \
    --region $REGION
  echo "  RDS instance creating... (this takes 5-8 minutes)"
else
  echo "  RDS instance already exists (status: $DB_STATUS)"
fi

# Wait for RDS to be available
echo "  Waiting for RDS to become available..."
aws rds wait db-instance-available --db-instance-identifier "${APP_NAME}-db" --region $REGION
DB_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier "${APP_NAME}-db" --query 'DBInstances[0].Endpoint.Address' --output text --region $REGION)
echo "  RDS Endpoint: $DB_ENDPOINT"

# ─── Step 4: Create key pair ─────────────────────────────────────────────────
echo ""
echo "[4/7] Creating SSH key pair..."
if [ ! -f "$KEY_FILE" ]; then
  aws ec2 delete-key-pair --key-name $KEY_NAME --region $REGION 2>/dev/null || true
  aws ec2 create-key-pair --key-name $KEY_NAME --query 'KeyMaterial' --output text --region $REGION > $KEY_FILE
  chmod 400 $KEY_FILE
  echo "  Key saved: $KEY_FILE"
else
  echo "  Key already exists: $KEY_FILE"
fi

# ─── Step 5: Launch EC2 ──────────────────────────────────────────────────────
echo ""
echo "[5/7] Launching EC2 instance (t2.micro)..."

# Get latest Amazon Linux 2023 AMI
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023*-x86_64" "Name=state,Values=available" \
  --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
  --output text --region $REGION)
echo "  AMI: $AMI_ID"

# Check if instance already exists
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=${APP_NAME}-app" "Name=instance-state-name,Values=running,pending" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text --region $REGION 2>/dev/null)

if [ "$INSTANCE_ID" = "None" ] || [ -z "$INSTANCE_ID" ]; then
  # User data script to set up the server
  USER_DATA=$(cat << 'USERDATA'
#!/bin/bash
dnf update -y
dnf install -y nodejs git nginx
npm install -g pm2
USERDATA
)

  INSTANCE_ID=$(aws ec2 run-instances \
    --image-id $AMI_ID \
    --instance-type t2.micro \
    --key-name $KEY_NAME \
    --security-group-ids $APP_SG_ID \
    --subnet-id $SUBNET_1 \
    --associate-public-ip-address \
    --user-data "$USER_DATA" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${APP_NAME}-app}]" \
    --query 'Instances[0].InstanceId' --output text --region $REGION)
  echo "  Instance launching: $INSTANCE_ID"
else
  echo "  Instance already exists: $INSTANCE_ID"
fi

# Wait for instance to be running
echo "  Waiting for instance to be running..."
aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $REGION

PUBLIC_IP=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --query 'Reservations[0].Instances[0].PublicIpAddress' --output text --region $REGION)
echo "  Public IP: $PUBLIC_IP"

# ─── Step 6: Wait for instance to finish user-data setup ─────────────────────
echo ""
echo "[6/7] Waiting for server to finish setting up (60s)..."
sleep 60

# ─── Step 7: Deploy app ──────────────────────────────────────────────────────
echo ""
echo "[7/7] Deploying app to EC2..."

# Create a deployment script to run on the instance
cat > /tmp/deploy-remote.sh << EOF
#!/bin/bash
set -e
cd /home/ec2-user

# Wait for user-data to finish
while ! command -v pm2 &> /dev/null; do
  echo "Waiting for PM2..."
  sleep 5
done

# Clone or pull
if [ ! -d "smashhh" ]; then
  # Copy app via scp instead of git (no GitHub needed)
  echo "App directory will be created by scp"
fi

cd smashhh

# Create .env
cat > .env << 'ENVFILE'
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${DB_ENDPOINT}:5432/${DB_NAME}
PORT=3000
NODE_ENV=production
SESSION_SECRET=the_onepiece_is_real
VAPID_PUBLIC_KEY=BBeWgxHU4ecGw9ShMCSr_E1EuENetFdL_HumNC-4D9UGzl-_xV55TGI1ndgPGmTW0XNq6I35M92YaaqC6hSAhno
VAPID_PRIVATE_KEY=-bWjBQSgc74_LC3pjRvxdiJHRPawS0lYluripwMLCzs
VAPID_SUBJECT=mailto:admin@yourdomain.com
ENVFILE

npm install --production

# Run migrations
node scripts/init-db.js
node scripts/seed-data.js

# Start with PM2
pm2 delete smashhh 2>/dev/null || true
pm2 start src/app.js --name smashhh
pm2 save
sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u ec2-user --hp /home/ec2-user 2>/dev/null || true

# Setup Nginx
sudo tee /etc/nginx/conf.d/smashhh.conf > /dev/null << 'NGINX'
server {
    listen 80;
    server_name _;
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

sudo systemctl enable nginx
sudo systemctl restart nginx

echo "DEPLOY COMPLETE"
EOF

# Copy the app to EC2 (excluding node_modules and .git)
echo "  Uploading app files..."
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'public/uploads/cash' \
  -e "ssh -i $KEY_FILE -o StrictHostKeyChecking=no" \
  /Users/mac/Desktop/smashhh/ ec2-user@$PUBLIC_IP:/home/ec2-user/smashhh/

# Create the .env on the server
echo "  Creating .env on server..."
ssh -i $KEY_FILE -o StrictHostKeyChecking=no ec2-user@$PUBLIC_IP << REMOTE
cat > /home/ec2-user/smashhh/.env << 'ENVFILE'
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${DB_ENDPOINT}:5432/${DB_NAME}
PORT=3000
NODE_ENV=production
SESSION_SECRET=the_onepiece_is_real
VAPID_PUBLIC_KEY=BBeWgxHU4ecGw9ShMCSr_E1EuENetFdL_HumNC-4D9UGzl-_xV55TGI1ndgPGmTW0XNq6I35M92YaaqC6hSAhno
VAPID_PRIVATE_KEY=-bWjBQSgc74_LC3pjRvxdiJHRPawS0lYluripwMLCzs
VAPID_SUBJECT=mailto:admin@yourdomain.com
ENVFILE
REMOTE

# Run the setup on the server
echo "  Installing dependencies and starting app..."
ssh -i $KEY_FILE -o StrictHostKeyChecking=no ec2-user@$PUBLIC_IP << 'REMOTE'
cd /home/ec2-user/smashhh
npm install --production 2>&1 | tail -3
node scripts/init-db.js 2>&1 | tail -5
node scripts/seed-data.js 2>&1 | tail -5
pm2 delete smashhh 2>/dev/null || true
pm2 start src/app.js --name smashhh
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ec2-user --hp /home/ec2-user 2>/dev/null || true
sudo tee /etc/nginx/conf.d/smashhh.conf > /dev/null << 'NGINX'
server {
    listen 80;
    server_name _;
    client_max_body_size 10M;
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
echo "DONE"
REMOTE

echo ""
echo "============================================"
echo "  DEPLOYMENT COMPLETE!"
echo "============================================"
echo ""
echo "  App URL:  http://$PUBLIC_IP"
echo "  SSH:      ssh -i $KEY_FILE ec2-user@$PUBLIC_IP"
echo ""
echo "  DB Host:  $DB_ENDPOINT"
echo "  DB Pass:  $DB_PASSWORD"
echo ""
echo "  All logins use password: 123"
echo "  Try: manager_dandenong / 123"
echo "============================================"
