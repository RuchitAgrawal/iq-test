document.addEventListener('DOMContentLoaded', () => {
    const screens = {
        welcome: document.getElementById('welcome-screen'),
        quiz: document.getElementById('quiz-screen'),
        result: document.getElementById('result-screen')
    };

    const startBtn = document.getElementById('start-btn');
    const questionContainer = document.getElementById('question-container');
    const progressBar = document.getElementById('progress-bar');
    
    let questions = [];
    let currentQuestionIndex = 0;
    let score = 0;
    
    // Switch between screens
    function showScreen(screenName) {
        Object.values(screens).forEach(screen => {
            screen.classList.remove('active');
            screen.classList.add('hidden');
        });
        screens[screenName].classList.remove('hidden');
        screens[screenName].classList.add('active');
    }

    async function fetchQuestions() {
        try {
            const res = await fetch('/api/questions');
            if (!res.ok) throw new Error('Failed to fetch questions');
            questions = await res.json();
            currentQuestionIndex = 0;
            score = 0;
            renderQuestion();
        } catch (error) {
            console.error(error);
            questionContainer.innerHTML = '<p>Error loading questions. Please try again.</p>';
        }
    }

    function renderQuestion() {
        if (currentQuestionIndex >= questions.length) {
            finishQuiz();
            return;
        }

        const q = questions[currentQuestionIndex];
        
        // Update progress bar
        const progressPercent = (currentQuestionIndex / questions.length) * 100;
        progressBar.style.width = `${progressPercent}%`;

        let optionsHtml = '';
        if (q.options && q.options.length > 0) {
            optionsHtml = q.options.map(opt => `
                <button class="option-btn" data-value="${opt}">${opt}</button>
            `).join('');
        }

        questionContainer.innerHTML = `
            <div class="question-prompt">
                <span class="question-number">Question ${currentQuestionIndex + 1} of ${questions.length}</span>
                <h2>${q.prompt}</h2>
            </div>
            <div class="options-grid">
                ${optionsHtml}
            </div>
        `;

        // Attach event listeners to options
        const optionBtns = questionContainer.querySelectorAll('.option-btn');
        optionBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                handleAnswer(e.target.dataset.value, q);
            });
        });
    }

    function handleAnswer(selectedValue, question) {
        if (selectedValue === question.answer) {
            score += question.difficulty; // weighted score
        }
        
        // Animate out, then show next
        questionContainer.style.opacity = '0';
        setTimeout(() => {
            currentQuestionIndex++;
            renderQuestion();
            questionContainer.style.opacity = '1';
        }, 300);
    }

    async function finishQuiz() {
        showScreen('result');
        progressBar.style.width = '100%';
        
        try {
            const res = await fetch('/api/score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ score })
            });
            
            if (!res.ok) throw new Error('Failed to submit score');
            
            const resultData = await res.json();
            
            document.getElementById('score-display').innerText = `Score: ${resultData.score} (Top ${100 - resultData.percentile}%)`;
            document.getElementById('type-label').innerText = resultData.typeLabel;
            
            // Set up share button
            const shareBtn = document.getElementById('share-btn');
            shareBtn.onclick = () => {
                const imageUrl = `${window.location.origin}/api/image/${resultData.resultId}`;
                // For MVP, just open the image in a new tab so they can save/share it
                window.open(imageUrl, '_blank');
            };
        } catch (error) {
            console.error(error);
            document.getElementById('score-display').innerText = `Score: ${score}`;
            document.getElementById('type-label').innerText = 'Error saving result';
        }
    }

    startBtn.addEventListener('click', () => {
        startBtn.innerText = 'Loading...';
        startBtn.disabled = true;
        fetchQuestions().then(() => {
            showScreen('quiz');
            startBtn.innerText = 'Start Quiz';
            startBtn.disabled = false;
        });
    });
});
