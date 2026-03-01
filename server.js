// ============================================================================
// WELFARE SCHEME PORTAL - BACKEND API SERVER
// Production-Ready with AWS Lambda, AI Integration, and Full CRUD
// ============================================================================

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const Anthropic = require('@anthropic-ai/sdk');
const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

dotenv.config();

const app = express();

// ============================================================================
// CONFIG & INITIALIZATION
// ============================================================================

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// AWS SDK Configuration
AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();
const cognito = new AWS.CognitoIdentityServiceProvider();
const sns = new AWS.SNS();

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// ============================================================================
// AUTH ROUTES
// ============================================================================

// USER REGISTRATION
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, state } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name required' });
    }

    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    const params = {
      TableName: 'Users',
      Item: {
        userId,
        email,
        password: hashedPassword,
        name,
        state: state || 'Karnataka',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        verified: false,
      },
    };

    await dynamoDB.put(params).promise();

    const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: { userId, email, name, state },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// USER LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const params = {
      TableName: 'Users',
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
    };

    const result = await dynamoDB.query(params).promise();

    if (result.Items.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.Items[0];
    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.userId, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    return res.json({
      success: true,
      token,
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        state: user.state,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET CURRENT USER
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const params = {
      TableName: 'Users',
      Key: { userId: req.user.userId },
    };

    const result = await dynamoDB.get(params).promise();

    if (!result.Item) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password, ...userWithoutPassword } = result.Item;
    return res.json(userWithoutPassword);
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// USER PROFILE ROUTES
// ============================================================================

// UPDATE USER PROFILE
app.put('/api/users/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { age, occupation, category, state, caste, income } = req.body;

    // Verify user is updating their own profile
    if (userId !== req.user.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const params = {
      TableName: 'Users',
      Key: { userId },
      UpdateExpression: 'SET age = :age, occupation = :occupation, category = :category, state = :state, caste = :caste, income = :income, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':age': age,
        ':occupation': occupation,
        ':category': category,
        ':state': state,
        ':caste': caste,
        ':income': income,
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    };

    const result = await dynamoDB.update(params).promise();
    return res.json({ success: true, user: result.Attributes });
  } catch (error) {
    console.error('Profile update error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET USER PROFILE
app.get('/api/users/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

    if (userId !== req.user.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const params = {
      TableName: 'Users',
      Key: { userId },
    };

    const result = await dynamoDB.get(params).promise();

    if (!result.Item) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password, ...userWithoutPassword } = result.Item;
    return res.json(userWithoutPassword);
  } catch (error) {
    console.error('Profile fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SCHEME ROUTES
// ============================================================================

// GET ALL SCHEMES (with pagination)
app.get('/api/schemes', async (req, res) => {
  try {
    const { limit = 20, startKey } = req.query;

    const params = {
      TableName: 'Schemes',
      Limit: parseInt(limit),
      ExclusiveStartKey: startKey ? JSON.parse(startKey) : undefined,
    };

    const result = await dynamoDB.scan(params).promise();

    return res.json({
      schemes: result.Items,
      count: result.Items.length,
      lastEvaluatedKey: result.LastEvaluatedKey,
    });
  } catch (error) {
    console.error('Schemes fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// SEARCH SCHEMES
app.get('/api/schemes/search', async (req, res) => {
  try {
    const { keyword, department, category } = req.query;

    let params = {
      TableName: 'Schemes',
      FilterExpression: '',
      ExpressionAttributeValues: {},
    };

    const filters = [];

    if (keyword) {
      filters.push('contains(#name, :keyword) OR contains(#description, :keyword)');
      params.ExpressionAttributeNames = {
        '#name': 'name',
        '#description': 'description',
      };
      params.ExpressionAttributeValues[':keyword'] = keyword;
    }

    if (department) {
      filters.push('department = :department');
      params.ExpressionAttributeValues[':department'] = department;
    }

    if (category) {
      filters.push('category = :category');
      params.ExpressionAttributeValues[':category'] = category;
    }

    if (filters.length > 0) {
      params.FilterExpression = filters.join(' AND ');
    } else {
      // If no filters, just scan all
      params = { TableName: 'Schemes' };
    }

    const result = await dynamoDB.scan(params).promise();

    return res.json({
      schemes: result.Items,
      count: result.Items.length,
    });
  } catch (error) {
    console.error('Scheme search error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET SINGLE SCHEME
app.get('/api/schemes/:schemeId', async (req, res) => {
  try {
    const { schemeId } = req.params;

    const params = {
      TableName: 'Schemes',
      Key: { schemeId },
    };

    const result = await dynamoDB.get(params).promise();

    if (!result.Item) {
      return res.status(404).json({ error: 'Scheme not found' });
    }

    return res.json(result.Item);
  } catch (error) {
    console.error('Scheme fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// AI ELIGIBILITY ENGINE (CLAUDE INTEGRATION)
// ============================================================================

app.post('/api/ai/evaluate-eligibility', authenticateToken, async (req, res) => {
  try {
    const { userProfile, schemes } = req.body;

    if (!userProfile || !schemes || schemes.length === 0) {
      return res.status(400).json({ error: 'User profile and schemes required' });
    }

    // Prepare system prompt with user's current data
    const systemPrompt = `You are an AI-powered Digital Public Infrastructure Agent designed to help Indian citizens discover and understand government welfare schemes.

Current Citizen Profile:
${JSON.stringify(userProfile, null, 2)}

Your task is to evaluate the citizen's eligibility for the provided schemes and rank them by relevance and approval likelihood.

For each scheme, provide:
1. Eligibility score (0.0-1.0)
2. Priority level (High/Medium/Low)
3. Why they are eligible or not
4. Missing criteria if any
5. Required documents
6. Benefit summary
7. Approval complexity

Be transparent, ground all responses in the provided data, and never hallucinate eligibility criteria.`;

    // Prepare user message with schemes
    const userMessage = `Please evaluate eligibility for these schemes:\n\n${JSON.stringify(
      schemes,
      null,
      2
    )}\n\nProvide the output in JSON format matching the recommendations structure.`;

    // Call Claude API
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    // Extract text response
    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    // Parse JSON from response
    let recommendations = [];
    try {
      // Extract JSON from response (Claude might wrap it in markdown)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        recommendations = JSON.parse(jsonMatch[0]).recommendations || [];
      } else {
        recommendations = JSON.parse(responseText).recommendations || [];
      }
    } catch (parseError) {
      console.warn('JSON parse error, returning raw response:', parseError);
      recommendations = [{ raw_response: responseText }];
    }

    return res.json({
      success: true,
      recommendations,
      evaluatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('AI evaluation error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET AI-POWERED SCHEME EXPLANATION
app.get('/api/ai/explain/:schemeId', authenticateToken, async (req, res) => {
  try {
    const { schemeId } = req.params;

    // Get scheme details
    const schemeParams = {
      TableName: 'Schemes',
      Key: { schemeId },
    };

    const schemeResult = await dynamoDB.get(schemeParams).promise();

    if (!schemeResult.Item) {
      return res.status(404).json({ error: 'Scheme not found' });
    }

    const scheme = schemeResult.Item;

    // Get user profile if authenticated
    let userProfile = {};
    try {
      const userParams = {
        TableName: 'Users',
        Key: { userId: req.user.userId },
      };
      const userResult = await dynamoDB.get(userParams).promise();
      userProfile = userResult.Item || {};
    } catch (e) {
      // Continue without user profile
    }

    // Call Claude for personalized explanation
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system:
        'You are a helpful assistant explaining Indian government welfare schemes in simple, accessible language. Explain how this scheme works, who benefits, and how to apply.',
      messages: [
        {
          role: 'user',
          content: `Explain this scheme in a simple, citizen-friendly way:\n\nScheme: ${scheme.name}\nDescription: ${scheme.description}\nEligibility: ${scheme.eligibility}\nBenefits: ${scheme.benefits}\n\nUser Profile: ${JSON.stringify(
            userProfile
          )}\n\nProvide the explanation in plain language, including:\n1. What the scheme offers\n2. Who can apply\n3. How to apply\n4. Required documents\n5. Timeline for approval`,
        },
      ],
    });

    const explanation = message.content[0].type === 'text' ? message.content[0].text : '';

    return res.json({
      schemeId,
      name: scheme.name,
      explanation,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Explanation error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// APPLICATION ROUTES
// ============================================================================

// CREATE APPLICATION
app.post('/api/applications', authenticateToken, async (req, res) => {
  try {
    const { schemeId, documents } = req.body;
    const { userId } = req.user;

    if (!schemeId) {
      return res.status(400).json({ error: 'Scheme ID required' });
    }

    const applicationId = uuidv4();

    const params = {
      TableName: 'Applications',
      Item: {
        applicationId,
        userId,
        schemeId,
        status: 'submitted',
        documents: documents || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    await dynamoDB.put(params).promise();

    return res.status(201).json({
      success: true,
      applicationId,
      message: 'Application submitted successfully',
    });
  } catch (error) {
    console.error('Application creation error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET USER APPLICATIONS
app.get('/api/users/:userId/applications', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

    if (userId !== req.user.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const params = {
      TableName: 'Applications',
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
    };

    const result = await dynamoDB.query(params).promise();

    return res.json({
      applications: result.Items,
      count: result.Items.length,
    });
  } catch (error) {
    console.error('Applications fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// UPDATE APPLICATION STATUS
app.put('/api/applications/:applicationId', authenticateToken, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { status, notes } = req.body;

    const params = {
      TableName: 'Applications',
      Key: { applicationId },
      UpdateExpression: 'SET #status = :status, notes = :notes, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': status,
        ':notes': notes || '',
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    };

    const result = await dynamoDB.update(params).promise();

    return res.json({ success: true, application: result.Attributes });
  } catch (error) {
    console.error('Application update error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// DOCUMENT UPLOAD ROUTES
// ============================================================================

// UPLOAD DOCUMENT TO S3
app.post('/api/upload/document', authenticateToken, async (req, res) => {
  try {
    const { documentName, documentData, applicationId } = req.body;

    if (!documentName || !documentData) {
      return res.status(400).json({ error: 'Document name and data required' });
    }

    const documentId = uuidv4();
    const key = `documents/${req.user.userId}/${applicationId}/${documentId}`;

    // Decode base64 data
    const buffer = Buffer.from(documentData.split(',')[1], 'base64');

    const s3Params = {
      Bucket: process.env.S3_BUCKET_NAME || 'welfare-portal-documents',
      Key: key,
      Body: buffer,
      ContentType: 'application/pdf',
      ServerSideEncryption: 'AES256',
    };

    await s3.upload(s3Params).promise();

    // Save metadata to DynamoDB
    const dbParams = {
      TableName: 'Documents',
      Item: {
        documentId,
        userId: req.user.userId,
        applicationId: applicationId || 'general',
        documentName,
        s3Key: key,
        uploadedAt: new Date().toISOString(),
        fileSize: buffer.length,
      },
    };

    await dynamoDB.put(dbParams).promise();

    return res.status(201).json({
      success: true,
      documentId,
      s3Key: key,
      message: 'Document uploaded successfully',
    });
  } catch (error) {
    console.error('Document upload error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET DOCUMENT UPLOAD URL
app.post('/api/documents/presigned-url', authenticateToken, async (req, res) => {
  try {
    const { fileName, fileType } = req.body;

    if (!fileName || !fileType) {
      return res.status(400).json({ error: 'File name and type required' });
    }

    const key = `documents/${req.user.userId}/${uuidv4()}/${fileName}`;

    const s3Params = {
      Bucket: process.env.S3_BUCKET_NAME || 'welfare-portal-documents',
      Key: key,
      Expires: 3600, // 1 hour
      ContentType: fileType,
    };

    const uploadUrl = await s3.getSignedUrlPromise('putObject', s3Params);

    return res.json({ uploadUrl, key });
  } catch (error) {
    console.error('Presigned URL error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// NOTIFICATION ROUTES
// ============================================================================

// SEND NOTIFICATION
app.post('/api/notifications/send', authenticateToken, async (req, res) => {
  try {
    const { message, type = 'info' } = req.body;
    const { userId } = req.user;

    // Get user email from database
    const userParams = {
      TableName: 'Users',
      Key: { userId },
    };

    const userResult = await dynamoDB.get(userParams).promise();

    if (!userResult.Item) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userEmail = userResult.Item.email;

    // Send email via SNS
    const snsParams = {
      TopicArn: process.env.SNS_TOPIC_ARN || 'arn:aws:sns:us-east-1:123456789:welfare-notifications',
      Subject: `Welfare Portal Notification - ${type.toUpperCase()}`,
      Message: message,
    };

    await sns.publish(snsParams).promise();

    // Store notification in DynamoDB
    const notificationId = uuidv4();
    const notifParams = {
      TableName: 'Notifications',
      Item: {
        notificationId,
        userId,
        userEmail,
        message,
        type,
        read: false,
        createdAt: new Date().toISOString(),
      },
    };

    await dynamoDB.put(notifParams).promise();

    return res.json({ success: true, notificationId });
  } catch (error) {
    console.error('Notification error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET USER NOTIFICATIONS
app.get('/api/users/:userId/notifications', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

    if (userId !== req.user.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const params = {
      TableName: 'Notifications',
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false, // Most recent first
    };

    const result = await dynamoDB.query(params).promise();

    return res.json({
      notifications: result.Items,
      count: result.Items.length,
    });
  } catch (error) {
    console.error('Notifications fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ANALYTICS ROUTES
// ============================================================================

// GET DASHBOARD STATS
app.get('/api/admin/stats', authenticateToken, async (req, res) => {
  try {
    // In production, verify admin role
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Count active users
    const userParams = {
      TableName: 'Users',
      Select: 'COUNT',
    };

    const userResult = await dynamoDB.scan(userParams).promise();

    // Count applications
    const appParams = {
      TableName: 'Applications',
      Select: 'COUNT',
    };

    const appResult = await dynamoDB.scan(appParams).promise();

    // Count schemes
    const schemeParams = {
      TableName: 'Schemes',
      Select: 'COUNT',
    };

    const schemeResult = await dynamoDB.scan(schemeParams).promise();

    return res.json({
      totalUsers: userResult.Count,
      totalApplications: appResult.Count,
      totalSchemes: schemeResult.Count,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Stats error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Welfare Portal API running on http://localhost:${PORT}`);
    console.log(`📊 AWS Region: ${AWS.config.region}`);
    console.log(`🤖 Claude AI Integration: Active`);
    console.log(`📚 API Documentation: http://localhost:${PORT}/api/docs`);
  });
}

module.exports = app;
