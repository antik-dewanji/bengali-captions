// netlify/functions/transcribe.js
// Real Bengali Transcription with OpenAI Whisper API

const FormData = require('form-data');
const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // CORS headers for cross-origin requests
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' })
    };
  }

  try {
    // Get OpenAI API key from environment variables
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    
    if (!OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'OpenAI API key not configured',
          setup: 'Add OPENAI_API_KEY to Netlify environment variables',
          help: 'Go to Site Settings > Environment Variables in Netlify dashboard'
        })
      };
    }

    // Handle test requests (for API connection testing)
    if (event.body) {
      try {
        const bodyData = JSON.parse(event.body);
        if (bodyData.test === true) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
              success: true, 
              message: 'API connected successfully',
              timestamp: Date.now(),
              apiKeyPresent: !!OPENAI_API_KEY
            })
          };
        }
      } catch (parseError) {
        // Not a JSON body, continue with file processing
      }
    }

    // Check content type for file uploads
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    
    if (!contentType || !contentType.includes('multipart/form-data')) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Content-Type must be multipart/form-data for audio uploads',
          received: contentType || 'none'
        })
      };
    }

    // Parse the multipart form data
    const body = Buffer.from(event.body, 'base64');
    
    // Validate audio file size (Whisper has 25MB limit)
    if (body.length > 25 * 1024 * 1024) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Audio file too large. Maximum size is 25MB.',
          fileSize: `${Math.round(body.length / (1024 * 1024))}MB`
        })
      };
    }

    // Create form data for OpenAI API
    const formData = new FormData();
    formData.append('file', body, {
      filename: 'audio.webm',
      contentType: 'audio/webm'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'bn'); // Bengali language code
    formData.append('response_format', 'json');
    formData.append('temperature', '0'); // More deterministic results

    console.log('Sending request to OpenAI Whisper API...');

    // Call OpenAI Whisper API
    const openaiResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI API Error:', errorText);
      
      let errorMessage = 'OpenAI API request failed';
      
      if (openaiResponse.status === 401) {
        errorMessage = 'Invalid OpenAI API key. Please check your key.';
      } else if (openaiResponse.status === 429) {
        errorMessage = 'OpenAI API rate limit exceeded. Please try again later.';
      } else if (openaiResponse.status === 413) {
        errorMessage = 'Audio file too large for OpenAI API.';
      }
      
      return {
        statusCode: openaiResponse.status,
        headers,
        body: JSON.stringify({ 
          error: errorMessage,
          details: errorText,
          status: openaiResponse.status
        })
      };
    }

    const transcriptionResult = await openaiResponse.json();
    console.log('OpenAI response received:', transcriptionResult);
    
    // Extract transcribed text
    let bengaliText = transcriptionResult.text || '';
    let originalText = bengaliText;
    
    // Check if the transcribed text is already in Bengali
    const isBengali = /[\u0980-\u09FF]/.test(bengaliText);
    
    // If not Bengali, translate to Bengali
    if (!isBengali && bengaliText.trim()) {
      try {
        console.log('Translating to Bengali...');
        const translatedText = await translateToBengali(bengaliText);
        if (translatedText) {
          bengaliText = translatedText;
        }
      } catch (translateError) {
        console.warn('Translation failed:', translateError);
        // Keep original text if translation fails
      }
    }

    // Return successful transcription result
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        original: originalText,
        bengali: bengaliText,
        language_detected: transcriptionResult.language || 'unknown',
        confidence: 0.95, // Whisper doesn't provide confidence scores
        timestamp: Date.now(),
        model: 'whisper-1',
        duration: transcriptionResult.duration || null
      })
    };

  } catch (error) {
    console.error('Transcription error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error during transcription',
        message: error.message,
        timestamp: Date.now()
      })
    };
  }
};

// Helper function to translate text to Bengali using Google Translate
async function translateToBengali(text) {
  try {
    console.log('Translating text:', text);
    
    // Using Google Translate's free API
    const response = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=bn&dt=t&q=${encodeURIComponent(text)}`
    );
    
    if (!response.ok) {
      throw new Error(`Translation API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data && data[0] && data[0][0] && data[0][0][0]) {
      const translatedText = data[0][0][0];
      console.log('Translation successful:', translatedText);
      return translatedText;
    }
    
    console.warn('Translation response format unexpected');
    return null;
    
  } catch (error) {
    console.error('Translation error:', error);
    return null;
  }
}
