import express from 'express';
import { DynamoDBClient, PutItemCommand, ScanCommand, GetItemCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const dynamoDbClient = new DynamoDBClient({ region: 'ap-south-1' });
const s3Client = new S3Client({ region: 'ap-south-1' });
const BUCKET_NAME = 'bucketg202312550';
const TABLE_NAME = 'PromptHistory';

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  next();
});

// POST /prompts
app.post('/prompts', async (req, res) => {
  try {
    const { prompt, mediaUrl, mediaType } = req.body;
    if (!prompt || !mediaUrl || !['image', 'audio', 'video'].includes(mediaType)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid prompt, mediaUrl, or mediaType (must be image, audio, or video)',
      });
    }

    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const params = {
      TableName: TABLE_NAME,
      Item: {
        id: { S: id },
        prompt: { S: prompt },
        mediaUrl: { S: mediaUrl },
        mediaType: { S: mediaType },
        createdAt: { S: createdAt },
        updatedAt: { S: createdAt },
      },
    };

    await dynamoDbClient.send(new PutItemCommand(params));
    res.status(201).json({
      id,
      prompt,
      mediaUrl,
      mediaType,
      createdAt,
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      status: 'error',
      message: `Failed to save prompt: ${error.message}`,
    });
  }
});

// GET /prompts
app.get('/prompts', async (req, res) => {
  try {
    const params = { TableName: TABLE_NAME };
    const data = await dynamoDbClient.send(new ScanCommand(params));
    const prompts = data.Items.map(item => ({
      id: item.id.S,
      prompt: item.prompt.S,
      mediaUrl: item.mediaUrl.S,
      mediaType: item.mediaType.S,
      createdAt: item.createdAt.S,
      updatedAt: item.updatedAt?.S,
    }));
    res.status(200).json(prompts);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: `Failed to list prompts: ${error.message}`,
    });
  }
});

// GET /prompts/:id
app.get('/prompts/:id', async (req, res) => {
  try {
    const params = {
      TableName: TABLE_NAME,
      Key: { id: { S: req.params.id } },
    };
    const data = await dynamoDbClient.send(new GetItemCommand(params));
    if (!data.Item) {
      return res.status(404).json({
        status: 'error',
        message: 'Prompt not found',
      });
    }
    res.status(200).json({
      id: data.Item.id.S,
      prompt: data.Item.prompt.S,
      mediaUrl: data.Item.mediaUrl.S,
      mediaType: data.Item.mediaType.S,
      createdAt: data.Item.createdAt.S,
      updatedAt: data.Item.updatedAt?.S,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: `Failed to get prompt: ${error.message}`,
    });
  }
});

// PUT /prompts/:id
app.put('/prompts/:id', async (req, res) => {
  try {
    const { prompt, mediaUrl, mediaType } = req.body;
    if (!prompt) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid prompt',
      });
    }

    const params = {
      TableName: TABLE_NAME,
      Key: { id: { S: req.params.id } },
      UpdateExpression: 'SET prompt = :p, updatedAt = :u, mediaUrl = :m, mediaType = :t',
      ExpressionAttributeValues: {
        ':p': { S: prompt },
        ':u': { S: new Date().toISOString() },
        ':m': { S: mediaUrl },
        ':t': { S: mediaType },
      },
      ReturnValues: 'ALL_NEW',
    };

    const data = await dynamoDbClient.send(new UpdateItemCommand(params));
    res.status(200).json({
      id: req.params.id,
      prompt: data.Attributes.prompt.S,
      mediaUrl: data.Attributes.mediaUrl.S,
      mediaType: data.Attributes.mediaType.S,
      createdAt: data.Attributes.createdAt.S,
      updatedAt: data.Attributes.updatedAt.S,
    });
  } catch (error) {
    if (error.name === 'ResourceNotFoundException' || error.name === 'ConditionalCheckFailedException') {
      return res.status(404).json({
        status: 'error',
        message: 'Prompt not found',
      });
    }
    res.status(500).json({
      status: 'error',
      message: `Failed to update prompt: ${error.message}`,
    });
  }
});

// DELETE /prompts/:id
app.delete('/prompts/:id', async (req, res) => {
  try {
    // Get prompt to retrieve mediaUrl
    const getParams = {
      TableName: TABLE_NAME,
      Key: { id: { S: req.params.id } },
    };
    const data = await dynamoDbClient.send(new GetItemCommand(getParams));
    if (!data.Item) {
      return res.status(404).json({
        status: 'error',
        message: 'Prompt not found',
      });
    }

    // Delete media from S3
    const mediaUrl = data.Item.mediaUrl.S;
    const fileName = mediaUrl.split('/').pop();
    const s3Params = {
      Bucket: BUCKET_NAME,
      Key: `generated-media/${fileName}`,
    };
    await s3Client.send(new DeleteObjectCommand(s3Params));

    // Delete from DynamoDB
    const deleteParams = {
      TableName: TABLE_NAME,
      Key: { id: { S: req.params.id } },
    };
    await dynamoDbClient.send(new DeleteItemCommand(deleteParams));

    res.status(204).send();
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      return res.status(404).json({
        status: 'error',
        message: 'Prompt not found',
      });
    }
    res.status(500).json({
      status: 'error',
      message: `Failed to delete prompt: ${error.message}`,
    });
  }
});

app.listen(8080, () => console.log('S3 running on port 8080'));