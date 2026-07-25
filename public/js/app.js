document.addEventListener('DOMContentLoaded', () => {
    const screens = {
        welcome: document.getElementById('welcome-screen'),
        quiz: document.getElementById('quiz-screen'),
        result: document.getElementById('result-screen')
    };

    const startBtn = document.getElementById('start-btn');
    const questionContainer = document.getElementById('question-container');
    const progressBar = document.getElementById('progress-bar');
    const timerDisplay = document.getElementById('timer-display');
    
    let questions = [];
    let currentQuestionIndex = 0;
    let score = 0;
    let categoryScores = { sequence: 0, logic: 0, pattern: 0, spatial: 0 };
    
    let startTime = null;
    let timerInterval = null;
    let elapsedSeconds = 0;

    function showScreen(screenName) {
        Object.values(screens).forEach(screen => {
            screen.classList.remove('active');
            screen.classList.add('hidden');
        });
        screens[screenName].classList.remove('hidden');
        screens[screenName].classList.add('active');
    }

    function startTimer() {
        startTime = Date.now();
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
            const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
            const secs = String(elapsedSeconds % 60).padStart(2, '0');
            if (timerDisplay) {
                timerDisplay.innerText = `⏱️ ${mins}:${secs}`;
            }
        }, 1000);
    }

    function stopTimer() {
        clearInterval(timerInterval);
    }

    async function fetchQuestions() {
        try {
            const res = await fetch('/api/questions');
            if (!res.ok) throw new Error('Failed to fetch questions');
            questions = await res.json();
            currentQuestionIndex = 0;
            score = 0;
            categoryScores = { sequence: 0, logic: 0, pattern: 0, spatial: 0 };
            renderQuestion();
            startTimer();
        } catch (error) {
            console.error(error);
            questionContainer.innerHTML = '<p>Error loading puzzle dataset. Please refresh and try again.</p>';
        }
    }

    function renderQuestion() {
        if (currentQuestionIndex >= questions.length) {
            stopTimer();
            finishQuiz();
            return;
        }

        const q = questions[currentQuestionIndex];
        
        const progressPercent = ((currentQuestionIndex) / questions.length) * 100;
        progressBar.style.width = `${progressPercent}%`;

        let visualHtml = '';
        if (q.visual_svg) {
            visualHtml = `<div class="visual-puzzle-box">${q.visual_svg}</div>`;
        }

        let optionsHtml = '';
        if (q.options && q.options.length > 0) {
            optionsHtml = q.options.map(opt => `
                <button class="option-btn" data-value="${opt}">
                    <span>${opt}</span>
                    <span>👉</span>
                </button>
            `).join('');
        }

        questionContainer.innerHTML = `
            <div class="question-prompt">
                <span class="question-number">Challenge ${currentQuestionIndex + 1} of ${questions.length} • ${q.category ? q.category.toUpperCase() : 'LOGIC'}</span>
                <h2>${q.prompt}</h2>
                ${visualHtml}
            </div>
            <div class="options-grid">
                ${optionsHtml}
            </div>
        `;

        const optionBtns = questionContainer.querySelectorAll('.option-btn');
        optionBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const button = e.currentTarget;
                handleAnswer(button.dataset.value, q);
            });
        });
    }

    function handleAnswer(selectedValue, question) {
        if (selectedValue === question.answer) {
            score += question.difficulty || 2;
            const cat = question.category || 'logic';
            if (!categoryScores[cat]) categoryScores[cat] = 0;
            categoryScores[cat] += question.difficulty || 2;
        }
        
        questionContainer.style.opacity = '0';
        questionContainer.style.transform = 'translateY(10px)';
        questionContainer.style.transition = 'all 0.25s ease';
        
        setTimeout(() => {
            currentQuestionIndex++;
            renderQuestion();
            questionContainer.style.opacity = '1';
            questionContainer.style.transform = 'translateY(0)';
        }, 250);
    }

    function renderCategoryStats(categories, accentColor) {
        const statsGrid = document.getElementById('stats-grid');
        if (!statsGrid) return;
        
        const catLabels = {
            logic: "Deductive Logic",
            pattern: "Pattern Cipher",
            spatial: "3D Spatial Rotation",
            sequence: "Abstract Sequence"
        };

        const html = Object.entries(categories).map(([key, val]) => {
            const label = catLabels[key] || key.toUpperCase();
            const percent = Math.min(100, Math.max(15, Math.floor((val / 15) * 100)));
            return `
                <div class="stat-row">
                    <div class="stat-labels">
                        <span>${label}</span>
                        <span>${val} pts</span>
                    </div>
                    <div class="stat-bar">
                        <div class="stat-fill" style="width: 0%; background: ${accentColor || '#3b82f6'};"></div>
                    </div>
                </div>
            `;
        }).join('');

        statsGrid.innerHTML = html;

        setTimeout(() => {
            const fills = statsGrid.querySelectorAll('.stat-fill');
            Object.values(categories).forEach((val, index) => {
                if (fills[index]) {
                    const percent = Math.min(100, Math.max(15, Math.floor((val / 15) * 100)));
                    fills[index].style.width = `${percent}%`;
                }
            });
        }, 100);
    }

    async function finishQuiz() {
        showScreen('result');
        progressBar.style.width = '100%';
        
        const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
        const secs = String(elapsedSeconds % 60).padStart(2, '0');
        const timeFormatted = `${mins}m ${secs}s`;
        
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const group_id = urlParams.get('group_id');
            const user_id = urlParams.get('user_id');
            
            const payload = {
                score,
                category_breakdown: categoryScores,
                time_taken: elapsedSeconds,
                group_id,
                user_id
            };

            const res = await fetch('/api/score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (!res.ok) throw new Error('Failed to submit diagnostic payload');
            
            const resultData = await res.json();
            
            const badge = document.getElementById('archetype-badge');
            if (badge) {
                badge.innerText = resultData.typeLabel || 'Lateral Alchemist';
                if (resultData.accentColor) {
                    badge.style.color = resultData.accentColor;
                    badge.style.textShadow = `0 0 30px ${resultData.accentColor}66`;
                }
            }

            document.getElementById('score-display').innerText = `Cognitive Score: ${resultData.score} (Top ${100 - resultData.percentile}% Rank)`;
            document.getElementById('type-description').innerText = resultData.description || 'Verified cognitive agility across multiple analytical domains.';
            
            renderCategoryStats(resultData.categories || categoryScores, resultData.accentColor);
            
            const shareBtn = document.getElementById('share-btn');
            if (shareBtn) {
                shareBtn.onclick = () => {
                    window.open(resultData.imageUrl, '_blank');
                    
                    const shareText = `🧠 I just calibrated as a Top ${100 - resultData.percentile}% [${resultData.typeLabel}] on the TLQ Cognitive Matrix!\n⚡ Velocity: ${timeFormatted} | Score: ${resultData.score}\n🟩 ⏩ 🟨 ⏩ 🟩\nCan you surpass my analytical breakdown? Test your brain right here 👉 ${window.location.origin}`;
                    
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(shareText).catch(console.error);
                        const toast = document.getElementById('share-toast');
                        if (toast) {
                            toast.classList.remove('hidden');
                            setTimeout(() => toast.classList.add('hidden'), 3500);
                        }
                    }
                };
            }
        } catch (error) {
            console.error(error);
            document.getElementById('score-display').innerText = `Cognitive Score: ${score}`;
            document.getElementById('type-description').innerText = 'Completed analytical session.';
            renderCategoryStats(categoryScores, '#3b82f6');
        }
    }

    startBtn.addEventListener('click', () => {
        startBtn.innerText = 'Initializing Matrix...';
        startBtn.disabled = true;
        fetchQuestions().then(() => {
            showScreen('quiz');
            startBtn.innerText = 'Launch Diagnostic';
            startBtn.disabled = false;
        });
    });
});
