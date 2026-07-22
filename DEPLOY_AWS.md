# Deploy to AWS Free Tier (Sydney)

## What you'll get
- App running on EC2 `t2.micro` (free for 12 months)
- PostgreSQL on RDS `db.t3.micro` (free for 12 months)
- Sydney region (`ap-southeast-2`) — fast for Australian users
- HTTPS via Let's Encrypt (free)

## Prerequisites
- AWS account with credit card (won't be charged)
- A domain name (optional, can use EC2 public IP)

---

## Step 1: Create an AWS Account

Go to https://aws.amazon.com/free and sign up. Select Sydney (`ap-southeast-2`) as your region in the top-right of the console.

---

## Step 2: Create RDS PostgreSQL Database

1. Go to **RDS** → **Create database**
2. Settings:
   - Engine: **PostgreSQL**
   - Template: **Free tier**
   - DB instance identifier: `smashhh-db`
   - Master username: `postgres`
   - Master password: (choose one, save it)
   - Instance: `db.t3.micro`
   - Storage: 20 GB (default)
   - Public access: **Yes** (for initial setup, disable later)
   - VPC security group: Create new → name it `smashhh-db-sg`
3. Click **Create database**
4. Wait ~5 min for it to be "Available"
5. Copy the **Endpoint** (e.g., `smashhh-db.xxxx.ap-southeast-2.rds.amazonaws.com`)

### Configure DB security group
1. Click on the DB → **VPC security group** link
2. Edit inbound rules → Add:
   - Type: PostgreSQL, Port: 5432, Source: `0.0.0.0/0` (for setup, restrict later)

### Create the database
```bash
psql -h YOUR_RDS_ENDPOINT -U postgres -c "CREATE DATABASE fashionshop;"
```

Then run the migrations:
```bash
export DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@YOUR_RDS_ENDPOINT:5432/fashionshop"
node scripts/init-db.js
node scripts/seed-data.js
```

---

## Step 3: Launch EC2 Instance

1. Go to **EC2** → **Launch instance**
2. Settings:
   - Name: `smashhh-app`
   - AMI: **Amazon Linux 2023** (free tier eligible)
   - Instance type: `t2.micro`
   - Key pair: Create new → download the `.pem` file
   - Network: Allow SSH (22), HTTP (80), HTTPS (443), Custom TCP (3000)
   - Storage: 8 GB (default)
3. Click **Launch instance**

---

## Step 4: Deploy Your App

### Connect to the instance
```bash
chmod 400 your-key.pem
ssh -i your-key.pem ec2-user@YOUR_EC2_PUBLIC_IP
```

### Install Node.js and Git
```bash
# On the EC2 instance:
sudo dnf install -y nodejs git
node --version  # should be 18+
```

### Clone and set up
```bash
git clone https://github.com/YOUR_USERNAME/smashhh.git
cd smashhh
npm install --production
```

### Create environment file
```bash
cat > .env << 'EOF'
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@YOUR_RDS_ENDPOINT:5432/fashionshop
PORT=3000
NODE_ENV=production
SESSION_SECRET=the_onepiece_is_real
VAPID_PUBLIC_KEY=BBeWgxHU4ecGw9ShMCSr_E1EuENetFdL_HumNC-4D9UGzl-_xV55TGI1ndgPGmTW0XNq6I35M92YaaqC6hSAhno
VAPID_PRIVATE_KEY=-bWjBQSgc74_LC3pjRvxdiJHRPawS0lYluripwMLCzs
VAPID_SUBJECT=mailto:admin@yourdomain.com
EOF
```

### Run database migrations (if not done from local)
```bash
node scripts/init-db.js
node scripts/seed-data.js
```

### Start with PM2 (keeps app running)
```bash
sudo npm install -g pm2
pm2 start src/app.js --name smashhh
pm2 startup  # auto-start on reboot
pm2 save
```

---

## Step 5: Set Up Nginx (port 80 → 3000)

```bash
sudo dnf install -y nginx
sudo tee /etc/nginx/conf.d/smashhh.conf > /dev/null << 'EOF'
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
EOF

sudo systemctl enable nginx
sudo systemctl start nginx
```

Your app is now live at `http://YOUR_EC2_PUBLIC_IP`

---

## Step 6: HTTPS with Let's Encrypt (optional, needs domain)

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

## Step 7: Restrict Database Access

Once everything works, go back to the RDS security group and change the inbound rule:
- Source: Change from `0.0.0.0/0` to your EC2 instance's **private IP** or its security group

---

## Updating the App

```bash
ssh -i your-key.pem ec2-user@YOUR_EC2_PUBLIC_IP
cd smashhh
git pull
npm install --production
pm2 restart smashhh
```

---

## Cost Summary (Free Tier)

| Resource | Monthly cost |
|----------|-------------|
| EC2 t2.micro | $0 (750 hrs free) |
| RDS db.t3.micro | $0 (750 hrs free) |
| Storage (28 GB total) | $0 (30 GB free) |
| Data transfer | $0 (100 GB free) |
| **Total** | **$0 for 12 months** |

After 12 months, EC2 `t2.micro` stays free forever. RDS will cost ~$13/month — at that point you can move Postgres onto the EC2 instance itself to keep it free.
