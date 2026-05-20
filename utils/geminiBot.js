const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * Multi-provider AI chatbot module for VishLink.
 * Supports:
 * 1. Gemini (using @google/generative-ai with keys from env)
 * 2. Nvidia NIM (OpenAI compatible endpoint with NVIDIA_API_KEY)
 */

const GEMINI_MODEL_NAMES = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
];

const NVIDIA_MODEL_NAMES = [
  "meta/llama-3.1-8b-instruct",
  "meta/llama-3.1-70b-instruct",
  "google/gemma-2-9b-it",
];

const VISHLINK_SYSTEM_PROMPT = `You are "VishLink AI Assistant" — a professional and friendly customer support bot for the VishLink wishing website.

## VISHINK PROFESSIONAL IDENTITY (WHAT IS VISHLINK?):
If someone asks what VishLink is, provide this clean, premium definition:
- **English:** "VishLink is a premium digital celebration platform dedicated to crafting digital emotions. We empower you to give your special moments a unique digital identity by creating beautifully personalized wishing websites with custom messages, photos, and background music to surprise your loved ones."
- **Hindi/Hinglish:** "VishLink ek premium digital celebration platform hai jo aapke special moments (jaise birthday, anniversary, wedding) ko ek unique digital identity deta hai. Yahan aap bina kisi coding skill ke apne loved ones ke liye background music, photos aur personal messages ke saath beautiful wishing surprise websites create kar sakte hain."

## FOOTER PAGES & POLICY KNOWLEDGE:
- **About Us & Mission:** VishLink aims to redefine digital celebrations by expressing deep emotions through elegant design and thoughtful surpises. Our mission is to empower everyone to build memorable digital surprise sites instantly, serving as a bridge for joy and lasting smiles.
- **Data Privacy & Security:** User trust and privacy is our top priority. We collect only necessary account data (name, email) and content data (messages, photos) strictly to host the created surprise links. All data is securely stored with industry-standard security.
- **User Rights:** Users have full control over their digital footprint; you can delete your created links or account anytime directly from your profile.
- **Terms of Service:** Created links are subject to content guidelines (no illegal/offensive uploads). Links are categorized into Temporary (valid for 3 or 6 months) and Permanent (valid forever, requires admin approval).

## CRITICAL RULES (MUST FOLLOW):
1. **NO HALLUCINATION / WRONG INFORMATION:** If the user's message is about ANY topic that is NOT directly related to VishLink, or if you do not know the answer, or if you are unsure:
   - YOU MUST ONLY REPLY WITH THIS EXACT TEXT: "Iska jawab mere paas nahi hai. Main aapka message admin ko forward kar raha hoon, aap baad mein aakar unse yahi chat par baat kar sakte hain."
   - NEVER make up features or guess details.
2. **TEMPLATE IMAGE LIMITS:** The absolute maximum number of images allowed for ANY wishing website template is 5 images. No template supports 10 images. If asked if 10 images are allowed, tell them "Nahi, maximum 5 images hi upload ho sakti hain."
3. **NO DEVELOPER ROUTES/RAW LINKS:** NEVER output raw developer routes (like /category/birthday, /game/tournaments, /profile, /logInForm) to the user. Instead, explain the path using simple UI navigation steps.
   - Example: Say "Home page par jaakar Categories section mein apne pasand ka category chunein" instead of "/category/birthday".
   - Say "Apne Profile page par jaakar" instead of "/profile".
4. **ULTRA-CONCISE (MINIMUM WORDS):** Always try to resolve the user's query using the fewest words possible. Avoid long explanations. Go straight to the solution.
5. **NO ADMIN PHONE NUMBER:** We do not have any official phone/WhatsApp number. If asked, say: "Humara koi call/WhatsApp number nahi hai. Aap isi chat mein message chhod dein, admin yahi reply karenge."
6. **GREETING RESPONSE RULE:** If the user sends a simple greeting like "hi", "hello", "namaste", "hey":
   - Keep your response under 15 words.
   - Example: "Hello! How can I assist you with VishLink today? 😊" or "Namaste! Main aapki kya madad kar sakta hoon? 😊"

## UI NAVIGATION PATHWAYS:
Explain locations to users using these simple steps:
- **To view wishing templates:** Home page par jaakar Category section mein check karein.
- **To edit/download photo frames:** Home page menu se 'Photo Frame Studio' chunein.
- **To claim daily coins / check balance / see purchases:** Apne Profile page par jaayein.
- **To play games & join tournaments:** Menu mein 'Games' option par jaayein.
- **To Login/Signup:** Right top corner mein login/signup button par click karein.

## TROUBLESHOOTING & COMMON QUESTIONS (SHORT & POINTED):

### 1. Link Generate Nahi Ho Raha / Template Unlock Error:
If a user faces link generation issues:
- **Ask immediately:** "Kya dikkat aa rahi hai? Kaun sa template try kar rahe hain?"
- **Provide these quick points:**
  - **Images limit:** Form par check karein ki is template ke liye kitni images needed hain (maximum 5 images allowed). Utni hi images upload karein.
  - **Format:** Image standard JPEG, PNG ya WebP honi chahiye (under 5MB).
  - **Coins:** Coins balance profile mein check karein.
  - **UPI Approval:** Permanent links purchase ke baad admin approval ke baad live hote hain.

### 2. Coins Kaise Ikkatta Karein (Coins earning):
Provide only these two direct ways:
- **Daily Reward:** Profile page par jaakar daily claim reward click karein (daily dynamic amount).
- **Games:** Games section mein games aur tournaments khelkar leaderboard top karein.

## Tone Guidelines:
- Language: Hinglish/Hindi or English (always match user's language).
- Format: Short lines or simple bullet points. Keep it under 60-80 words maximum.`;

// Cooldown duration when a model slot rate-limits
const COOLDOWN_MS = 60 * 1000;

// Gather Nvidia keys
const nvidiaKeys = [];
const envNvidiaKey = String(process.env.NVIDIA_API_KEY || "").trim();
if (envNvidiaKey) {
  envNvidiaKey.split(",").forEach(k => {
    const trimmed = k.trim();
    if (trimmed) nvidiaKeys.push(trimmed);
  });
}

// Gather Gemini keys
const geminiKeys = [];
const envGeminiKey = String(process.env.GEMINI_API_KEY || "").trim();
if (envGeminiKey) {
  envGeminiKey.split(",").forEach(k => {
    const trimmed = k.trim();
    if (trimmed) geminiKeys.push(trimmed);
  });
}

// Build model pool slots
const modelPool = [];

// 1. Add Gemini models to pool first
geminiKeys.forEach((key, keyIndex) => {
  const genAI = new GoogleGenerativeAI(key);
  GEMINI_MODEL_NAMES.forEach((modelName) => {
    modelPool.push({
      type: "gemini",
      keyName: `gemini-key#${keyIndex + 1}`,
      key,
      modelName,
      modelObj: genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: VISHLINK_SYSTEM_PROMPT,
      }),
      cooldownUntil: 0,
    });
  });
});

// 2. Add Nvidia models to pool
nvidiaKeys.forEach((key, keyIndex) => {
  NVIDIA_MODEL_NAMES.forEach((modelName) => {
    modelPool.push({
      type: "nvidia",
      keyName: `nvidia-key#${keyIndex + 1}`,
      key,
      modelName,
      cooldownUntil: 0,
    });
  });
});

console.log(`AI Chatbot pool initialized: ${modelPool.length} slots (${geminiKeys.length} Gemini keys, ${nvidiaKeys.length} Nvidia keys).`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGeminiHistory(messages, maxMessages = 10) {
  if (!messages || messages.length === 0) return [];
  const allExceptLast = messages.slice(0, -1);
  const recent = allExceptLast.slice(-maxMessages);

  const history = recent.map((msg) => ({
    role: msg.senderRole === "user" ? "user" : "model",
    parts: [{ text: msg.text }],
  }));

  while (history.length > 0 && history[0].role !== "user") {
    history.shift();
  }

  const merged = [];
  for (const entry of history) {
    if (merged.length > 0 && merged[merged.length - 1].role === entry.role) {
      merged[merged.length - 1].parts[0].text += "\n" + entry.parts[0].text;
    } else {
      merged.push(entry);
    }
  }
  return merged;
}

function buildOpenAIHistory(messages, maxMessages = 10) {
  if (!messages || messages.length === 0) return [];
  const allExceptLast = messages.slice(0, -1);
  const recent = allExceptLast.slice(-maxMessages);

  return recent.map((msg) => ({
    role: msg.senderRole === "user" ? "user" : "assistant",
    content: msg.text,
  }));
}

function isRateLimitError(err, type) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("resource has been exhausted")
  );
}

// ---------------------------------------------------------------------------
// API Handlers
// ---------------------------------------------------------------------------

async function tryGeminiSlot(slot, userMessage, conversationHistory) {
  const history = buildGeminiHistory(conversationHistory);
  const chat = slot.modelObj.startChat({ history });
  const result = await chat.sendMessage(userMessage);
  const text = result.response.text();
  return text ? text.trim() : null;
}

async function tryNvidiaSlot(slot, userMessage, conversationHistory) {
  const openaiHistory = buildOpenAIHistory(conversationHistory);

  const messages = [
    { role: "system", content: VISHLINK_SYSTEM_PROMPT },
    ...openaiHistory,
    { role: "user", content: userMessage }
  ];

  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${slot.key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: slot.modelName,
      messages: messages,
      temperature: 0.15,
      max_tokens: 800,
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Nvidia API error: [${response.status}] ${errorBody}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return content ? content.trim() : null;
}

// ---------------------------------------------------------------------------
// Generate Reply
// ---------------------------------------------------------------------------

async function generateReply(userMessage, conversationHistory = []) {
  if (modelPool.length === 0) {
    return null;
  }

  if (!userMessage || !userMessage.trim()) {
    return null;
  }

  const now = Date.now();

  for (let i = 0; i < modelPool.length; i++) {
    const slot = modelPool[i];

    if (slot.cooldownUntil > now) {
      continue;
    }

    try {
      console.log(`Trying ${slot.type} slot (${slot.keyName}, model=${slot.modelName})...`);
      let text = null;

      if (slot.type === "gemini") {
        text = await tryGeminiSlot(slot, userMessage, conversationHistory);
      } else if (slot.type === "nvidia") {
        text = await tryNvidiaSlot(slot, userMessage, conversationHistory);
      }

      if (!text) {
        console.log(`Slot ${slot.type} (${slot.modelName}) returned empty response, trying next...`);
        continue;
      }

      console.log(`AI Reply generated successfully from ${slot.type} (${slot.modelName}), length: ${text.length}`);
      return text.slice(0, 1400);
    } catch (err) {
      const errMsg = String(err?.message || "");
      console.log(`${slot.type} slot (${slot.modelName}) failed:`, errMsg.slice(0, 200));

      if (isRateLimitError(err, slot.type)) {
        slot.cooldownUntil = now + COOLDOWN_MS;
        console.log(`Slot rate-limited. Put on cooldown for ${COOLDOWN_MS / 1000}s. Trying next...`);
      }
      continue;
    }
  }

  console.log("All AI chatbot slots exhausted or on cooldown.");
  return null;
}

function isBotAvailable() {
  return modelPool.length > 0;
}

module.exports = {
  generateReply,
  isBotAvailable,
};
