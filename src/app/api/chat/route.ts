import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Configure S3 Client
const s3Client = new S3Client({
  region: 'eu-west-1'
});

export async function POST(req: Request) {
  // Destructure request data
  const { messages, selectedModel, data } = await req.json();

  // Remove experimental_attachments from each message
  const cleanedMessages = messages.map((message: any) => {
    const { experimental_attachments, ...cleanMessage } = message;
    return cleanMessage;
  });

  let message = 'Please provide an image for object detection.';
 
  // Check if there are images for object detection
  if (data?.images && data.images.length > 0) {
    try {
      // Handle object detection for the first image
      const imageUrl = data.images[0];
      
      // Convert data URL to blob and then to buffer for upload
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Upload to S3
      const s3Key = `uploads/${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET || '',
        Key: s3Key,
        Body: buffer,
        ContentType: 'image/jpeg',
      }));
      
      // Create URL with query parameters for the YOLO service
      const yoloServiceUrl = new URL(`http://${process.env.YOLO_SERVICE}/predict`);
      yoloServiceUrl.searchParams.append('img', s3Key);
      
      // Call the object detection API
      const predictionResponse = await fetch(yoloServiceUrl.toString(), {
        method: 'POST'
      });
      
      if (!predictionResponse.ok) {
        throw new Error(`Prediction API error: ${predictionResponse.status}`);
      }
      
      const predictionResult = await predictionResponse.json();
      
      // Format the detection results for chat
      message = `🔍 **Object Detection Results**

**Detection Count:** ${predictionResult.detection_count}
**Detected Objects:** ${predictionResult.labels.join(', ')}
**Prediction ID:** ${predictionResult.prediction_uid}

I've analyzed your image and detected ${predictionResult.detection_count} object(s). The detected objects include: ${predictionResult.labels.join(', ')}.`;
    
    } catch (error) {
      console.error('Object detection error:', error);
      message = `❌ **Object Detection Error**

Sorry, I encountered an error while processing your image: ${error instanceof Error ? error.message : 'Unknown error'}

Please make sure the object detection service is running on localhost:8080.`;
     }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Split message into lines and send each line as a separate chunk
      const lines = message.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Add newline character back except for the last line
        const content = i < lines.length - 1 ? line + '\n' : line;
        controller.enqueue(encoder.encode(`0:${JSON.stringify(content)}\n`));
      }
      
      // Send finish event
      controller.enqueue(encoder.encode(`e:${JSON.stringify({
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: message.length },
        isContinued: false
      })}\n`));
      
      // Send done event
      controller.enqueue(encoder.encode(`d:${JSON.stringify({
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: message.length }
      })}\n`));
      
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Vercel-AI-Data-Stream': 'v1',
    },
  });
}





// import { createOllama } from 'ollama-ai-provider';
// import { streamText, convertToCoreMessages, CoreMessage, UserContent } from 'ai';

// export const runtime = "edge";
// export const dynamic = "force-dynamic";

// export async function POST(req: Request) {
//   // Destructure request data
//   const { messages, selectedModel, data } = await req.json();

//   const ollamaUrl = process.env.OLLAMA_URL;

//   const initialMessages = messages.slice(0, -1); 
//   const currentMessage = messages[messages.length - 1]; 

//   const ollama = createOllama({baseURL: ollamaUrl + "/api"});

//   // Build message content array directly
//   const messageContent: UserContent = [{ type: 'text', text: currentMessage.content }];

//   // Add images if they exist
//   data?.images?.forEach((imageUrl: string) => {
//     const image = new URL(imageUrl);
//     messageContent.push({ type: 'image', image });
//   });

//   // Stream text using the ollama model
//   const result = await streamText({
//     model: ollama(selectedModel),
//     messages: [
//       ...convertToCoreMessages(initialMessages),
//       { role: 'user', content: messageContent },
//     ],
//   });

//   return result.toDataStreamResponse();
// }