const config = require("../config");
const { stripCodeFences } = require("../utils/helpers");

async function callOpenAIForExtraction(messageText, context = {}) {
  const prompt = `
You extract registration actions from WhatsApp messages for event sign-ups.

Return STRICT JSON only.
No markdown.
No explanation.
No text outside JSON.

Schema:
{
  "actions": [
    {
      "type": "registration" | "cancellation" | "update" | "other",
      "event": "April",
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

Recent sender context:
${JSON.stringify(context, null, 2)}

Rules:
1. Support Chinese and English.
2. Preserve names exactly as written. Do not translate names.
3. Resolve references using recent sender context, including phrases like "以上三位", "上述三位", "这三位", "same people", and "the above people".
4. If a message lists multiple people, extract all of them.
5. Numbered entries like "2) name / phone" are separate people.
6. If a message says "全部女性", apply Female to all listed people.
7. If the month is stated, extract it as the event.
8. If the month is not stated, leave event empty.
9. If a Chinese name and an English name appear together for the same applicant, treat them as one person and combine into one name field, Chinese first then English.
10. Do not invent names or phone numbers.
11. If one phone number clearly belongs to the whole listed group, you may apply that same phone to all of them.
12. If the message says Saturday only: sat=true, sun=false.
13. If the message says Sunday only: sat=false, sun=true.
14. If the message clearly says both days: sat=true, sun=true.
15. If the message only mentions sign-up with no day restriction, leave sat and sun as true.
16. Memorial tablet names such as 牌位, 往生莲位, 婴灵牌位, 历代祖先莲位, 消灾, 冤亲债主 are NOT registrants.
17. If the message is not a real registration/cancellation/update, return type "other".
19. If a specific calendar date is mentioned, refer to the calendar and infer the correct weekday whether is it a saturday or sunday
20. If the mentioned date is a Saturday session, set sat=true and sun=false.
21. If the mentioned date is a Sunday session, set sat=false and sun=true.
22. Do not set both days true when a single specific date is given.

Message:
${messageText}
`.trim();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openAiApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a precise JSON information extractor for event registration messages.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const cleaned = stripCodeFences(content);

  return JSON.parse(cleaned);
}

module.exports = {
  callOpenAIForExtraction,
};
