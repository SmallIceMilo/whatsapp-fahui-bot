const { OpenAI } = require("openai");
const config = require("../config");
const { stripCodeFences } = require("../utils/helpers");

const openai = new OpenAI({ apiKey: config.openAiApiKey });

async function callOpenAIForExtraction(messageText, context = {}, base64Image = null, mimeType = null) {
  const currentDate = new Date().toLocaleDateString('en-GB', { timeZone: config.timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const prompt = `
You extract registration actions from WhatsApp messages for event sign-ups.

Return STRICT JSON only. No markdown. No explanation. No text outside JSON.

Schema:
{
  "actions": [
    {
      "type": "registration" | "cancellation" | "update" | "other",
      "event": "August",
      "people": [
        {
          "name": "蔡美群 chai mee kwan",
          "phone": "82296768",
          "gender": "Female",
          "sat": true,
          "sun": true
        }
      ]
    }
  ]
}

Today's date is: ${currentDate}

Recent sender context:
${JSON.stringify(context, null, 2)}

Rules for Name Extraction:
- If a user says "I am helping my mum to register, her name is X", the registrant's name is X, not "mum". Pay close attention to who is actually attending.
- Ignore names of people who are just helping to register but not attending (e.g. "my name is ang siew fong, i want to help my mum to register and her name is paulin", the name is paulin).
- Support Chinese and English. Preserve names exactly as written. Do not translate.
- If a Chinese name and an English name appear together for the same applicant, treat them as one person and combine into one name field (Chinese first then English).
- Memorial tablet names such as 牌位, 往生莲位, 婴灵牌位, 历代祖先莲位, 消灾, 冤亲债主 are NOT registrants.

Rules for Event and Date Extraction:
- The exact upcoming events are:
  - "8/9 August"
  - "10/11 October"
  - "17/18 October"
- CRITICAL: If a user registers for multiple events in one message (e.g. both August and October, or both 10/11 Oct and 17/18 Oct), you MUST return MULTIPLE actions in the JSON array, one for each event!
- If the user mentions "10 Oct", "11 Oct", "10/10", "11/10", or mid-October, extract the event exactly as "10/11 October".
- If the user mentions "17 Oct", "18 Oct", "17/10", "18/10", or late-October, extract the event exactly as "17/18 October".
- If the user only says "October" without a date, check the poster image if available. If no image, assume the nearest upcoming October event based on today's date.
- If the user does not specify an event, assume they are registering for the NEXT upcoming event based on today's date (${currentDate}).
- CRITICAL DAY LOGIC: Pay close attention to the exact dates mentioned in ANY language or format (e.g., "10/10", "10 Oct", "Oct 10", "10号", "10日", "10", "Saturday", "星期六", etc):
  - If they ONLY mention dates corresponding to the FIRST day of the event (e.g. the 8th, 10th, or 17th), set sat=true, sun=false.
  - If they ONLY mention dates corresponding to the SECOND day of the event (e.g. the 9th, 11th, or 18th), set sat=false, sun=true.
  - If they mention both dates (e.g., "10 & 11", "both days", "两天") or don't specify any particular date, set both sat=true and sun=true.
- If the message contains an image (poster), read the poster to determine the correct event month and date.

General Rules:
- If a message lists multiple people, extract all of them. Numbered entries like "2) name / phone" are separate people.
- If "全部女性" (all female) is mentioned, apply Female to all.
- Resolve references using context (e.g., "以上三位", "same people").
- If one phone number belongs to the group, apply it to all. Do not invent numbers.
- If the message is not a real registration/cancellation/update, return type "other".

Message:
${messageText || "[Image Only]"}
`.trim();

  const userContent = [{ type: "text", text: prompt }];

  if (base64Image && mimeType) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${mimeType};base64,${base64Image}` }
    });
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a precise JSON information extractor for event registration messages. You can analyze images if provided.",
      },
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  const content = response.choices[0]?.message?.content || "";
  const cleaned = stripCodeFences(content);

  return JSON.parse(cleaned);
}

module.exports = {
  callOpenAIForExtraction,
};
