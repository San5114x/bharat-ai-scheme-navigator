// ============================================================================
// DEPLOYMENT GUIDE - WELFARE PORTAL
// Production-Ready Deployment to AWS
// ============================================================================

# PART 1: LOCAL DEVELOPMENT SETUP
# ===========================================================================

## 1.1 Prerequisites
- Node.js 18.x
- AWS CLI configured
- Git for version control
- Anthropic API key (Claude AI)
- AWS Account with $100 credit

## 1.2 Installation

```bash
# Clone repository
git clone https://github.com/your-org/welfare-portal.git
cd welfare-portal

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install

# Copy environment template
cd ../backend
cp .env.example .env

# Edit .env with your credentials
nano .env
```

## 1.3 Local Development

```bash
# Terminal 1: Start backend
cd backend
npm run dev

# Terminal 2: Start frontend (if using local server)
cd frontend
npm start

# Access at http://localhost:3000
```

---

# PART 2: AWS SETUP
# ===========================================================================

## 2.1 Create AWS Account & Get Credits

1. Create AWS Account
2. Add $100 AWS Credits (hack2skill provides)
3. Go to AWS Management Console
4. Create IAM User for deployment:
   - Services: DynamoDB, S3, Lambda, API Gateway, CloudFront, SNS, CloudWatch
   - Copy Access Key ID and Secret Access Key

## 2.2 Configure AWS Credentials

```bash
# Install AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Configure credentials
aws configure
# Enter:
# AWS Access Key ID: [your-key]
# AWS Secret Access Key: [your-secret]
# Default region: us-east-1
# Default output format: json
```

## 2.3 Verify AWS Setup

```bash
aws sts get-caller-identity
aws s3 ls
aws dynamodb list-tables
```

---

# PART 3: DATABASE SETUP
# ===========================================================================

## 3.1 Create DynamoDB Tables

```bash
cd backend
node db-init.js
```

This creates:
- Users (auth & profiles)
- Schemes (3500+ welfare schemes)
- Applications (user applications)
- Documents (uploaded PDFs)
- Notifications (alerts)
- Analytics (usage stats)

## 3.2 Seed Scheme Data

```bash
node seed-schemes.js
```

This populates DynamoDB with:
- Central welfare schemes (PMJDY, AYUSHMAN, etc.)
- State schemes (Karnataka, Tamil Nadu, etc.)
- Eligibility criteria
- Required documents
- Portal links

---

# PART 4: DEPLOY BACKEND TO AWS LAMBDA
# ===========================================================================

## 4.1 Create Lambda Function

```bash
# Package application
zip -r lambda-deployment.zip . \
  -x "node_modules/*" "*.git*" "*.md" "test/*"

# Create Lambda function via AWS CLI
aws lambda create-function \
  --function-name welfare-portal-api \
  --runtime nodejs18.x \
  --role arn:aws:iam::YOUR_ACCOUNT_ID:role/lambda-execution-role \
  --handler server.handler \
  --zip-file fileb://lambda-deployment.zip \
  --timeout 60 \
  --memory-size 512 \
  --environment Variables="{NODE_ENV=production,ANTHROPIC_API_KEY=your_key}"
```

## 4.2 Create API Gateway

```bash
# Use AWS Console to:
# 1. Create REST API
# 2. Create Lambda integration
# 3. Enable CORS
# 4. Deploy to stage 'prod'
# 5. Get endpoint URL
```

Or via CLI:

```bash
aws apigateway create-rest-api \
  --name welfare-portal-api \
  --description "Welfare Scheme Portal API"
```

## 4.3 Deploy via CloudFormation

```bash
aws cloudformation create-stack \
  --stack-name welfare-portal \
  --template-body file://aws-infrastructure.yaml \
  --parameters ParameterKey=Environment,ParameterValue=production
```

---

# PART 5: DEPLOY FRONTEND TO S3 + CloudFront
# ===========================================================================

## 5.1 Build Frontend

```bash
cd frontend

# Update API_BASE_URL in your HTML
# Change: window.API_BASE_URL = 'http://localhost:3000/api'
# To: window.API_BASE_URL = 'https://your-api-gateway-url/api'

# Create single HTML file with all assets embedded
npm run build
```

## 5.2 Upload to S3

```bash
# Create bucket
aws s3 mb s3://welfare-portal-website-123456789

# Upload files
aws s3 sync ./dist s3://welfare-portal-website-123456789 \
  --delete \
  --cache-control "max-age=3600"

# Make public
aws s3api put-bucket-policy \
  --bucket welfare-portal-website-123456789 \
  --policy file://bucket-policy.json
```

## 5.3 Enable CloudFront CDN

```bash
aws cloudfront create-distribution \
  --distribution-config file://cloudfront-config.json
```

Get CloudFront URL and use as your public domain.

---

# PART 6: CONFIGURE CUSTOM DOMAIN
# ===========================================================================

## 6.1 Register Domain

1. Go to Route 53
2. Register domain: welfareportal.in (or your choice)
3. Cost: ~$10/year

## 6.2 Add SSL Certificate

```bash
# Request certificate in ACM
aws acm request-certificate \
  --domain-name welfareportal.in \
  --validation-method DNS
```

Wait for DNS validation, then attach to CloudFront.

## 6.3 Create Route 53 Record

```bash
# Point welfareportal.in → CloudFront distribution
aws route53 change-resource-record-sets \
  --hosted-zone-id YOUR_ZONE_ID \
  --change-batch file://dns-change.json
```

---

# PART 7: ENVIRONMENT VARIABLES
# ===========================================================================

## 7.1 Update Lambda Environment

```bash
aws lambda update-function-configuration \
  --function-name welfare-portal-api \
  --environment Variables='{
    "NODE_ENV": "production",
    "AWS_REGION": "us-east-1",
    "ANTHROPIC_API_KEY": "YOUR_API_KEY",
    "JWT_SECRET": "your_jwt_secret_key",
    "FRONTEND_URL": "https://welfareportal.in",
    "S3_BUCKET_NAME": "welfare-portal-documents-123456789",
    "SNS_TOPIC_ARN": "arn:aws:sns:us-east-1:123456789:welfare-notifications"
  }'
```

## 7.2 Protect Secrets

```bash
# Use AWS Secrets Manager instead of environment variables
aws secretsmanager create-secret \
  --name welfare-portal/api-keys \
  --secret-string '{
    "anthropic_key": "your_key",
    "jwt_secret": "your_secret"
  }'

# Update Lambda to read from Secrets Manager (see lambda-handler.js)
```

---

# PART 8: TESTING
# ===========================================================================

## 8.1 Test API Endpoints

```bash
# Register user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123",
    "name": "Test User",
    "state": "Karnataka"
  }'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123"
  }'

# Get schemes
curl http://localhost:3000/api/schemes

# Evaluate eligibility
curl -X POST http://localhost:3000/api/ai/evaluate-eligibility \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userProfile": {
      "age": 35,
      "occupation": "farmer",
      "category": "general",
      "income": 50000
    },
    "schemes": [...]
  }'
```

## 8.2 Run Unit Tests

```bash
npm test
npm run test:coverage
```

---

# PART 9: MONITORING & LOGGING
# ===========================================================================

## 9.1 View Logs

```bash
# CloudWatch Logs for Lambda
aws logs tail /aws/lambda/welfare-portal-api --follow

# API Gateway Logs
aws logs tail /aws/apigateway/welfare-portal --follow
```

## 9.2 Set Up Alarms

Already included in CloudFormation template:
- DynamoDB throttling
- S3 bucket size
- Lambda errors
- API latency

View in CloudWatch Dashboard.

## 9.3 Enable X-Ray Tracing

```bash
aws lambda update-function-configuration \
  --function-name welfare-portal-api \
  --tracing-config Mode=Active

# View traces in X-Ray console
```

---

# PART 10: COST OPTIMIZATION
# ===========================================================================

## Budget: $100 AWS Credits

### Monthly Cost Estimate:

- **DynamoDB**: $0 (pay-per-request tier, free for light usage)
- **Lambda**: $0 (free tier: 1M requests)
- **S3**: $2 (for document storage)
- **CloudFront**: $5 (for CDN)
- **Data Transfer**: $3
- **Total**: ~$10/month (well within budget!)

### Cost-Saving Tips:

1. Use `PAY_PER_REQUEST` billing for DynamoDB
2. Enable S3 lifecycle policies (delete old documents after 90 days)
3. Use CloudFront for caching
4. Monitor spending: `aws ce get-cost-and-usage`
5. Set budget alert:

```bash
aws budgets create-budget \
  --account-id YOUR_ACCOUNT_ID \
  --budget file://budget.json
```

---

# PART 11: PRODUCTION CHECKLIST
# ===========================================================================

## Security
- [ ] Enable API authentication (JWT)
- [ ] Set up CORS properly
- [ ] Enable HTTPS/SSL
- [ ] Use AWS Secrets Manager for keys
- [ ] Enable DynamoDB encryption
- [ ] Enable S3 bucket encryption
- [ ] Set up IAM roles with least privilege
- [ ] Enable CloudTrail for audit logs

## Performance
- [ ] Enable CloudFront caching
- [ ] Compress API responses
- [ ] Optimize Lambda cold starts
- [ ] Use connection pooling for databases
- [ ] Implement rate limiting

## Monitoring
- [ ] Set up CloudWatch alarms
- [ ] Enable detailed logging
- [ ] Monitor API latency
- [ ] Track error rates
- [ ] Monitor DynamoDB capacity
- [ ] Alert on unusual activity

## Maintenance
- [ ] Enable automatic backups
- [ ] Set up disaster recovery plan
- [ ] Document API endpoints
- [ ] Create runbooks for common issues
- [ ] Schedule regular security audits

## Hackathon Presentation
- [ ] Create demo video (3-5 min)
- [ ] Prepare pitch deck
- [ ] Document architecture
- [ ] Show live demo
- [ ] Highlight AI integration
- [ ] Emphasize social impact

---

# PART 12: FUTURE STARTUP ROADMAP
# ===========================================================================

## Phase 1: MVP (Hackathon)
✅ Single state portal
✅ AI-powered eligibility
✅ Multilingual support
✅ Mobile responsive

## Phase 2: Growth (Months 1-3)
- [ ] Expand to 28 states
- [ ] Add SMS notifications
- [ ] Implement WhatsApp bot
- [ ] Add document OCR
- [ ] Create admin dashboard

## Phase 3: Scale (Months 3-12)
- [ ] B2B API for NGOs
- [ ] Integration with government portals
- [ ] Mobile apps (iOS/Android)
- [ ] Add video tutorials
- [ ] Implement chat support

## Phase 4: Monetization
- [ ] B2B licensing to districts
- [ ] Premium features for users
- [ ] Data insights for policy makers
- [ ] Sponsored job listings
- [ ] Partner commissions

---

# QUICK START COMMANDS
# ===========================================================================

```bash
# Full deployment (one command)
./deploy.sh

# Or manual:

# 1. Setup AWS
aws configure

# 2. Initialize database
cd backend
node db-init.js

# 3. Deploy infrastructure
aws cloudformation create-stack \
  --stack-name welfare-portal \
  --template-body file://aws-infrastructure.yaml

# 4. Deploy API
npm run deploy

# 5. Build & deploy frontend
cd ../frontend
npm run build
aws s3 sync ./dist s3://welfare-portal-website-ACCOUNT_ID

# 6. View CloudFront URL
aws cloudfront list-distributions

# Done! 🎉
```

---

# SUPPORT & TROUBLESHOOTING
# ===========================================================================

## Common Issues:

**"DynamoDB table does not exist"**
```bash
node db-init.js
```

**"Lambda timeout"**
Increase timeout: aws lambda update-function-configuration --timeout 60

**"S3 bucket access denied"**
Check bucket policy and CORS configuration

**"API returning 401"**
Check JWT token and CORS headers

**"CloudFront not showing latest version"**
Invalidate cache: `aws cloudfront create-invalidation --distribution-id YOUR_ID --paths "/*"`

---

For support:
- GitHub Issues: github.com/your-org/welfare-portal/issues
- Email: support@welfareportal.in
- WhatsApp: +91-XXXX-XXXX-XXXX

Good luck with your hackathon! 🚀
