// Meedish Legal Web Chat Bot Logic

const GEMINI_API_KEY = 'AIzaSyCeNoUTcGvAZk_yn5kjoH9Dl1z2BrErfIE';
const SYSTEM_PROMPT = 'You are a Legal Assistant for e-tebeka. Your goal is to help citizens understand general court procedures, filing requirements, and court levels in Ethiopia. IMPORTANT: Always include a disclaimer that you are an AI and cannot provide legal advice. Be formal, helpful, and concise.';

function toggleChat() {
    document.getElementById('chatWidget').classList.toggle('active');
}

async function handleChat(event) {
    event.preventDefault();
    const input = document.getElementById('chatInput');
    const messagesContainer = document.getElementById('chatMessages');
    const indicator = document.getElementById('typingIndicator');
    const text = input.value.trim();

    if (!text) return;

    // Add user message
    addMessage(text, 'user');
    input.value = '';

    // Show typing indicator
    indicator.style.display = 'block';
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `${SYSTEM_PROMPT}\n\nUser: ${text}`
                    }]
                }]
            })
        });

        const data = await response.json();
        const botText = data.candidates[0].content.parts[0].text;

        // Hide indicator and add bot message
        indicator.style.display = 'none';
        addMessage(botText, 'bot');
    } catch (error) {
        console.error('Chat error:', error);
        indicator.style.display = 'none';
        addMessage('Sorry, I am having trouble connecting right now. Please try again later.', 'bot');
    }
}

function addMessage(text, sender) {
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = `message message-${sender}`;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}
