const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Executes a Gemini request using primary key and fails over to backup key if needed.
 */
async function generateContentWithFailover(prompt, responseMimeType) {
  const primaryKey = process.env.GEMINI_API_KEY;
  const backupKey = process.env.GEMINI_API_KEY_BACKUP;
  const keys = [primaryKey, backupKey].filter(Boolean);
  
  // Try gemini-2.5-flash first as requested, then fallback to other models
  const models = ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-2.5-flash-lite"];

  for (const modelName of models) {
    for (const key of keys) {
      try {
        const keySuffix = key.slice(-6);
        console.log(`Attempting Gemini generation with model "${modelName}" using key suffix "...${keySuffix}"...`);
        
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: modelName });
        
        // Use native timeout (20s) to prevent indefinite hangs
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: responseMimeType ? { responseMimeType } : undefined
        }, { timeout: 20000 });

        const text = result.response.text();
        if (text) {
          console.log(`Gemini generation succeeded with model "${modelName}"!`);
          return text;
        }
      } catch (error) {
        const keySuffix = key.slice(-6);
        console.warn(`Model "${modelName}" failed with key "...${keySuffix}": ${error.message}`);
      }
    }
  }

  throw new Error("All Gemini models and API keys failed to generate content.");
}

/**
 * Calls Gemini to generate narration and quizzes for all slides.
 * Implements 3-retry logic with exponential backoff.
 */
async function generateLessonContent(slides) {
  const slidesInfo = slides.map(s => `
Slide ${s.slideNumber}:
${s.extractedText}
`).join('\n');

  const prompt = `
You are an expert Maruti Suzuki sales trainer. I will give you the extracted slide text of a PowerPoint presentation for the new mid-size SUV "Maruti Suzuki Victoris".
For each slide, you need to generate:
1. A professional trainer narration script ("narrationText"). It must be an engaging, sales-focused explanation of the slide content, explaining any technical terms (such as TPMS, ESP, ADAS, ALLGRIP Select AWD) in simple, customer-friendly language. It must be written in the tone of a real sales coach conducting a live classroom. Length must be between 80 to 150 words (about 35 to 80 seconds of speech). Do not simply read the slide text.
2. A short transition script ("quizIntroText") that transitions the slide into a quiz, e.g., "Now, let's see how well you understand the Victoris technology. Here is a quick question."
3. A multiple-choice question ("quiz") that tests product knowledge based ONLY on the current slide contents. The quiz must have:
   - "question": A clear multiple-choice question (easy to moderate difficulty).
   - "options": An array of exactly 4 strings.
   - "correctAnswer": The 0-based index of the correct option (0, 1, 2, or 3).
   - "explanation": A detailed, customer-friendly explanation of why the answer is correct and details about the feature.

CRITICAL FACTUAL DETAILS (You MUST get these right):
- Leatherette seats were REMOVED from ZXi and ZXi(O) variants as of October 2025. Never promise leatherette seats in ZXi.
- Panoramic sunroof is only in ZXi(O) and above. It is NOT in ZXi.
- ADAS is only in petrol-AT (top) variants. It is NOT in CNG or Strong Hybrid.

You MUST return a valid JSON array of objects representing each slide, matching this JSON schema:
[
  {
    "slideNumber": 1,
    "narrationText": "...",
    "quizIntroText": "...",
    "quiz": {
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "correctAnswer": 0,
      "explanation": "..."
    }
  }
]

Do not return any markdown wrappers, code blocks, or preamble. Return ONLY raw JSON text.

Slides content:
${slidesInfo}
`;

  let attempts = 0;
  const maxRetries = 3;
  let delay = 2000; // start with 2s

  while (attempts <= maxRetries) {
    try {
      const responseText = await generateContentWithFailover(prompt, "application/json");
      // Clean potential markdown blocks if JSON mode fallback returned it
      let cleanJson = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(cleanJson);
      
      if (!Array.isArray(parsedData) || parsedData.length !== slides.length) {
        throw new Error("Invalid structure returned by Gemini: array size mismatch");
      }
      
      return parsedData;
    } catch (error) {
      attempts++;
      console.warn(`Gemini generation attempt ${attempts} failed: ${error.message}`);
      if (attempts > maxRetries) {
        throw new Error(`Gemini content generation failed after ${maxRetries} retries: ${error.message}`);
      }
      console.log(`Waiting ${delay}ms before retrying...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // exponential backoff
    }
  }
}

/**
 * Generates an answer for a trainee's question based on slide and lesson content.
 */
async function generateAnswerForQuestion(question, currentSlide, allSlides) {
  const pptContent = allSlides.map(s => `Slide ${s.slideNumber}: ${s.extractedText}`).join('\n\n');

  const prompt = `
You are a professional Maruti Suzuki sales trainer conducting a live classroom training session.
You need to answer a trainee's question about the current slide.

Here is the context of the PowerPoint presentation (PPT content and Lesson content):
${pptContent}

Current Slide Details:
- Title: Slide ${currentSlide.slideNumber}
- Current Slide Text: ${currentSlide.extractedText}
- Current Slide Context (Narration): ${currentSlide.narrationText}

Trainee's Question:
"${question}"

KNOWLEDGE RULES:
1. You must use ONLY the provided PPT/lesson content and current slide context.
2. Do NOT search the internet.
3. Do NOT invent specifications or features.
4. Do NOT answer unrelated questions.
5. If the question is outside the lesson scope (not about the Maruti Suzuki Victoris product information covered in this session), you must respond politely in one sentence:
"That's outside the scope of the current training module. Let's focus on the Victoris product information covered in this session."

AI RESPONSE STYLE:
- Act like a professional Maruti Suzuki sales trainer.
- Tone: Friendly, confident, helpful, patient, and trainer-like.
- Do NOT sound like a chatbot.
- Do NOT sound like technical documentation.
- ABSOLUTELY FORBIDDEN: Do NOT include ANY greetings, trainee praise, or introductory filler phrases. Never output or start sentences like "Excellent question", "That's an excellent question", "Good question", "That's a great question", "Let me address that", "Sure", or similar.
- MANDATORY: You must start the answer immediately with a direct slide reference (e.g., "As you can see right here on Slide ${currentSlide.slideNumber}..." or "Looking at Slide ${currentSlide.slideNumber}...").
- Use natural conversational explanations.

ANSWER LENGTH & CONTENT:
- Keep the answer to a maximum of 40-50 words. Be extremely concise.
- Cover one core point only. No multi-part explanations.
- Plain spoken English suited for sales trainees.

CRITICAL: Do NOT start the response with "Excellent question", "Good question", or any greeting. Begin the response immediately with a reference to the slide number (e.g., "As you can see right here on Slide ${currentSlide.slideNumber}...").

Answer:
`;

  const answerText = await generateContentWithFailover(prompt);
  return answerText.trim();
}

module.exports = {
  generateLessonContent,
  generateAnswerForQuestion
};

