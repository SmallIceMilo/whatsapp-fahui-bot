const { OpenAI } = require("openai");
const config = require("../config");
const { stripCodeFences } = require("../utils/helpers");

const openai = new OpenAI({ apiKey: config.openAiApiKey });

async function callOpenAIForExtraction(messageText, context = {}, base64Image = null, mimeType = null) {
  const currentDate = new Date().toLocaleDateString('en-GB', { timeZone: config.timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const prompt = `
You extract registration actions from WhatsApp messages for Buddhist event sign-ups.

Return STRICT JSON only. No markdown. No explanation. No text outside JSON.

Schema:
{
  "actions": [
    {
      "type": "registration" | "cancellation" | "update" | "other",
      "event": "8/9 August",
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

===== EVENT RULES =====
The exact upcoming events are:
  - "8/9 August"   → Saturday is 8 Aug, Sunday is 9 Aug
  - "10/11 October" → Saturday is 10 Oct, Sunday is 11 Oct
  - "17/18 October" → Saturday is 17 Oct, Sunday is 18 Oct

Event identification:
- "8 Aug", "8月8日", "8号", "8/8" → 8/9 August (Saturday)
- "9 Aug", "8月9日", "9号", "9/8" → 8/9 August (Sunday)
- "10 Oct", "10月10日", "10/10", "10号" in October context → 10/11 October (Saturday)
- "11 Oct", "10月11日", "11/10", "11号" in October context → 10/11 October (Sunday)
- "17 Oct", "10月17日", "17/10" → 17/18 October (Saturday)
- "18 Oct", "10月18日", "18/10" → 17/18 October (Sunday)
- If user says only "October" with no date, use nearest upcoming October event based on today's date.
- If no event mentioned, use the NEXT upcoming event based on today's date.
- If user registers for MULTIPLE events in one message, return MULTIPLE actions (one per event).

===== DAY (sat/sun) RULES =====
CRITICAL: sat and sun are set PER PERSON. Read carefully what day each individual person is attending.

Day logic:
- sat=true means they attend the SATURDAY (first day of the event).
- sun=true means they attend the SUNDAY (second day of the event).

How to determine sat/sun:
1. If a person's entry says "1天" or "1日" (1 day):
   - Look at WHICH date is mentioned near their name.
   - If only the Saturday date (8th, 10th, 17th) → sat=true, sun=false
   - If only the Sunday date (9th, 11th, 18th) → sat=false, sun=true
   - If the date is ambiguous with "1天" and no specific day → sat=true, sun=false (default to first day)

2. If a person's entry says "2天", "两天", "兩天" (2 days) → sat=true, sun=true

3. If the message says "8月8、9号" or "10月10.11号" or "8号9号" (both dates listed) → sat=true, sun=true for those people

4. If no day is specified for a person → sat=true, sun=true (default: both days)

5. Day names: "星期六", "周六", "Saturday" → that Saturday only (sat=true, sun=false)
              "星期日", "星期天", "周日", "Sunday" → that Sunday only (sat=false, sun=true)

IMPORTANT: In messages with multiple people, each person may have DIFFERENT sat/sun values.
Read the line for each person separately. Do NOT apply one person's day to everyone.

Examples:
- "陈玉卿 女 8月8、9 2天" → sat=true, sun=true
- "林惠芳 8月9日1天" → sat=false, sun=true  (9th = Sunday)
- "蔡宝娟 女 8月9日1天" → sat=false, sun=true  (9th = Sunday)
- "林淑华2天" in a message about "10月10.11号" → sat=true, sun=true
- "someone 8月8号1天" → sat=true, sun=false  (8th = Saturday)

===== NAME RULES =====
- If a user says "I am helping my mum to register, her name is X", the registrant is X.
- Ignore names of people who are just helping but NOT attending.
- Support Chinese and English. Preserve names exactly as written. Do not translate.
- If a Chinese name and English name appear together for the same person, combine them (Chinese first, then English) into one name field.
- Memorial tablet entries (牌位, 往生莲位, 婴灵牌位, 历代祖先莲位, 消灾, 冤亲债主) are NOT registrants.

===== GENERAL RULES =====
- If a message lists multiple people, extract ALL of them.
- Numbered entries like "2) name / phone" are separate people.
- If "全部女性" (all female) is mentioned, apply Female gender to all.
- Resolve references using context (e.g., "以上三位", "same people as before").
- If one phone number is shared for the whole group, apply it to all. Do not invent numbers.
- If the message is clearly not a registration/cancellation/update, return type "other".

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
    model: "gpt-4o",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a precise JSON information extractor for Buddhist event registration messages. You can read Chinese and English. You can analyze images if provided. Always follow the rules exactly.",
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
