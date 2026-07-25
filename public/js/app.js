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
        const hasSvgOptions = Array.isArray(q.options_svg) && q.options_svg.length === (q.options ? q.options.length : 0);
        if (q.options && q.options.length > 0) {
            optionsHtml = q.options.map((opt, idx) => `
                <button class="option-btn ${hasSvgOptions ? 'visual-option-btn' : ''}" data-value="${opt}">
                    ${hasSvgOptions ? `<div class="option-svg-icon">${q.options_svg[idx]}</div>` : '<span class="option-indicator"></span>'}
                    <span class="option-text">${opt}</span>
                </button>
            `).join('');
        }

        questionContainer.innerHTML = `
            <div class="question-prompt">
                <span class="question-number">Challenge ${currentQuestionIndex + 1} of ${questions.length} • ${q.category ? q.category.toUpperCase() : 'LOGIC'}</span>
                <h2>${q.prompt}</h2>
                ${visualHtml}
            </div>
            <div class="options-grid ${hasSvgOptions ? 'visual-options-grid' : ''}">
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
        
        const color = accentColor || '#3b82f6';
        const logicVal = Number(categories.logic || 78);
        const patternVal = Number(categories.pattern || 78);
        const spatialVal = Number(categories.spatial || 78);
        const sequenceVal = Number(categories.sequence || 78);

        const getRatio = (val) => Math.max(0.2, Math.min(1.0, 0.2 + ((val - 78) / 72) * 0.8));

        const rLogic = getRatio(logicVal);
        const rPattern = getRatio(patternVal);
        const rSpatial = getRatio(spatialVal);
        const rSequence = getRatio(sequenceVal);

        const ptLogic = [180, 130 - 75 * rLogic];
        const ptPattern = [180 + 75 * rPattern, 130];
        const ptSpatial = [180, 130 + 75 * rSpatial];
        const ptSequence = [180 - 75 * rSequence, 130];

        const spiderSvg = `
            <div class="spider-chart-container" style="display: flex; flex-direction: column; align-items: center; width: 100%; padding: 10px 0;">
                <svg viewBox="0 0 360 260" style="width: 100%; max-width: 360px; overflow: visible;">
                    <polygon points="180,105 205,130 180,155 155,130" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
                    <polygon points="180,80 230,130 180,180 130,130" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
                    <polygon points="180,55 255,130 180,205 105,130" fill="rgba(30,41,59,0.35)" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>
                    
                    <line x1="180" y1="55" x2="180" y2="205" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="3,3"/>
                    <line x1="105" y1="130" x2="255" y2="130" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="3,3"/>
                    
                    <polygon id="spider-poly" points="180,130 180,130 180,130 180,130" fill="${color}55" stroke="${color}" stroke-width="3" style="filter: drop-shadow(0px 0px 8px ${color}88);"/>
                    
                    <circle id="circle-logic" cx="180" cy="130" r="4.5" fill="#ffffff" stroke="${color}" stroke-width="2"/>
                    <circle id="circle-pattern" cx="180" cy="130" r="4.5" fill="#ffffff" stroke="${color}" stroke-width="2"/>
                    <circle id="circle-spatial" cx="180" cy="130" r="4.5" fill="#ffffff" stroke="${color}" stroke-width="2"/>
                    <circle id="circle-sequence" cx="180" cy="130" r="4.5" fill="#ffffff" stroke="${color}" stroke-width="2"/>
                    
                    <text id="lbl-logic" x="180" y="32" fill="#f8fafc" font-size="13" font-weight="800" text-anchor="middle">Logic (78)</text>
                    <text id="lbl-pattern" x="268" y="134" fill="#f8fafc" font-size="13" font-weight="800" text-anchor="start">Pattern (78)</text>
                    <text id="lbl-spatial" x="180" y="235" fill="#f8fafc" font-size="13" font-weight="800" text-anchor="middle">Spatial (78)</text>
                    <text id="lbl-sequence" x="92" y="134" fill="#f8fafc" font-size="13" font-weight="800" text-anchor="end">Sequence (78)</text>
                </svg>
            </div>
        `;

        statsGrid.innerHTML = spiderSvg;

        const poly = document.getElementById('spider-poly');
        const cLogic = document.getElementById('circle-logic');
        const cPattern = document.getElementById('circle-pattern');
        const cSpatial = document.getElementById('circle-spatial');
        const cSequence = document.getElementById('circle-sequence');
        const lLogic = document.getElementById('lbl-logic');
        const lPattern = document.getElementById('lbl-pattern');
        const lSpatial = document.getElementById('lbl-spatial');
        const lSequence = document.getElementById('lbl-sequence');

        let startTime = null;
        const duration = 1200;

        function animate(timestamp) {
            if (!startTime) startTime = timestamp;
            const progress = Math.min(1, (timestamp - startTime) / duration);
            const ease = 1 - Math.pow(1 - progress, 3);

            const curLogicY = 130 - (130 - ptLogic[1]) * ease;
            const curPatternX = 180 + (ptPattern[0] - 180) * ease;
            const curSpatialY = 130 + (ptSpatial[1] - 130) * ease;
            const curSequenceX = 180 - (180 - ptSequence[0]) * ease;

            if (poly) poly.setAttribute('points', `${180},${curLogicY} ${curPatternX},${130} ${180},${curSpatialY} ${curSequenceX},${130}`);
            if (cLogic) cLogic.setAttribute('cy', curLogicY);
            if (cPattern) cPattern.setAttribute('cx', curPatternX);
            if (cSpatial) cSpatial.setAttribute('cy', curSpatialY);
            if (cSequence) cSequence.setAttribute('cx', curSequenceX);

            if (lLogic) lLogic.textContent = `Logic (${Math.round(78 + (logicVal - 78) * ease)})`;
            if (lPattern) lPattern.textContent = `Pattern (${Math.round(78 + (patternVal - 78) * ease)})`;
            if (lSpatial) lSpatial.textContent = `Spatial (${Math.round(78 + (spatialVal - 78) * ease)})`;
            if (lSequence) lSequence.textContent = `Sequence (${Math.round(78 + (sequenceVal - 78) * ease)})`;

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        }
        requestAnimationFrame(animate);
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
            
            const toIQ = (val, avgVal) => {
                const num = Number(val || 0);
                if (num >= 75) return Math.min(152, Math.max(78, Math.round(num)));
                return Math.min(152, Math.max(78, Math.round(78 + (num / avgVal) * 22)));
            };

            resultData.score = toIQ(resultData.score, 28);
            if (resultData.categories) {
                resultData.categories.logic = toIQ(resultData.categories.logic, 7);
                resultData.categories.pattern = toIQ(resultData.categories.pattern, 7);
                resultData.categories.spatial = toIQ(resultData.categories.spatial, 7);
                resultData.categories.sequence = toIQ(resultData.categories.sequence, 7);
            }
            
            const badge = document.getElementById('archetype-badge');
            if (badge) {
                badge.innerText = resultData.typeLabel || 'Lateral Alchemist';
                if (resultData.accentColor) {
                    badge.style.color = resultData.accentColor;
                    badge.style.textShadow = `0 0 30px ${resultData.accentColor}66`;
                }
            }

            document.getElementById('score-display').innerText = `Cognitive IQ: ${resultData.score} (Top ${100 - resultData.percentile}% Rank)`;
            document.getElementById('type-description').innerText = resultData.description || 'Verified cognitive agility across multiple analytical domains.';
            
            renderCategoryStats(resultData.categories || categoryScores, resultData.accentColor);
            
            const shareBtn = document.getElementById('share-btn');
            const shareModal = document.getElementById('share-modal');
            const closeModalBtn = document.getElementById('close-modal-btn');
            const modalCardPreview = document.getElementById('modal-card-preview');
            const whatsappBtn = document.getElementById('app-whatsapp-btn');
            const telegramBtn = document.getElementById('app-telegram-btn');
            const twitterBtn = document.getElementById('app-twitter-btn');
            const downloadBtn = document.getElementById('app-download-btn');

            if (closeModalBtn && shareModal) {
                closeModalBtn.onclick = () => shareModal.classList.add('hidden');
            }

            if (shareBtn) {
                shareBtn.innerText = '⚡ Share Matrix & Select App';
                shareBtn.onclick = async () => {
                    shareBtn.innerText = 'Preparing Challenge Card...';
                    shareBtn.disabled = true;

                    const testUrl = window.location.origin || 'http://localhost:3000';
                    const c = resultData.categories || {};
                    const statsSummary = `Logic: ${c.logic || 85} | Pattern: ${c.pattern || 85} | Spatial: ${c.spatial || 85} | Sequence: ${c.sequence || 85}`;
                    const shareText = `🧠 TLQ COGNITIVE MATRIX\n👑 Rank: Top ${100 - resultData.percentile}% [${resultData.typeLabel}]\n⚡ Velocity: ${timeFormatted} | C-IQ Index: ${resultData.score}\n🎯 Sub-Indices: ${statsSummary}\n\nCan you surpass my analytical agility? Play right here 👉 ${testUrl}`;
                    
                    let imageBlob = null;
                    let imageFile = null;
                    try {
                        const imgRes = await fetch(resultData.imageUrl);
                        imageBlob = await imgRes.blob();
                        imageFile = new File([imageBlob], 'tlq-cognitive-card.png', { type: imageBlob.type || 'image/png' });
                    } catch (fetchErr) {
                        console.error('Failed to fetch card image blob:', fetchErr);
                    }

                    shareBtn.innerText = '⚡ Share Matrix & Select App';
                    shareBtn.disabled = false;

                    if (navigator.canShare && imageFile && navigator.canShare({ files: [imageFile] })) {
                        try {
                            await navigator.share({
                                title: `TLQ Cognitive Profile: ${resultData.typeLabel}`,
                                text: shareText,
                                files: [imageFile]
                            });
                            return;
                        } catch (shareErr) {
                            console.log('System app selector dismissed or unavailable, launching custom picker.', shareErr);
                        }
                    }

                    if (imageBlob && navigator.clipboard && navigator.clipboard.write) {
                        try {
                            const item = new ClipboardItem({ [imageBlob.type || 'image/png']: imageBlob });
                            await navigator.clipboard.write([item]);
                        } catch (clipErr) {
                            console.log('Clipboard image copy fallback:', clipErr);
                            if (navigator.clipboard.writeText) {
                                navigator.clipboard.writeText(shareText).catch(console.error);
                            }
                        }
                    } else if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(shareText).catch(console.error);
                    }

                    if (shareModal) {
                        if (modalCardPreview) modalCardPreview.src = resultData.imageUrl;
                        shareModal.classList.remove('hidden');

                        const copyImgBtn = document.getElementById('modal-copy-image-btn');
                        const copyTxtBtn = document.getElementById('modal-copy-text-btn');

                        if (copyImgBtn && imageBlob && navigator.clipboard && navigator.clipboard.write) {
                            copyImgBtn.onclick = async () => {
                                try {
                                    const item = new ClipboardItem({ [imageBlob.type || 'image/png']: imageBlob });
                                    await navigator.clipboard.write([item]);
                                    copyImgBtn.innerText = '✅ Image Copied!';
                                    setTimeout(() => { copyImgBtn.innerText = '🖼️ 1. Re-Copy Image'; }, 2500);
                                } catch (err) {
                                    console.error('Image copy failed:', err);
                                }
                            };
                        }

                        if (copyTxtBtn && navigator.clipboard && navigator.clipboard.writeText) {
                            copyTxtBtn.onclick = async () => {
                                try {
                                    await navigator.clipboard.writeText(shareText);
                                    copyTxtBtn.innerText = '✅ Caption Copied!';
                                    setTimeout(() => { copyTxtBtn.innerText = '📝 2. Copy Caption Text'; }, 2500);
                                } catch (err) {
                                    console.error('Text copy failed:', err);
                                }
                            };
                        }

                        if (whatsappBtn) {
                            whatsappBtn.onclick = () => {
                                window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`, '_blank');
                            };
                        }

                        if (telegramBtn) {
                            telegramBtn.onclick = () => {
                                window.open(`https://t.me/share/url?url=${encodeURIComponent(testUrl)}&text=${encodeURIComponent(shareText)}`, '_blank');
                            };
                        }

                        if (twitterBtn) {
                            twitterBtn.onclick = () => {
                                window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, '_blank');
                            };
                        }

                        if (downloadBtn) {
                            downloadBtn.onclick = () => {
                                const a = document.createElement('a');
                                a.href = resultData.imageUrl;
                                a.download = `TLQ-${resultData.typeLabel.replace(/\s+/g, '-')}-Card.png`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                            };
                        }
                    }
                };
            }
        } catch (error) {
            console.error(error);
            const toIQ = (val, avgVal) => {
                const num = Number(val || 0);
                if (num >= 75) return Math.min(152, Math.max(78, Math.round(num)));
                return Math.min(152, Math.max(78, Math.round(78 + (num / avgVal) * 22)));
            };
            const fallbackIq = toIQ(score, 28);
            const fallbackCats = {
                logic: toIQ(categoryScores.logic, 7),
                pattern: toIQ(categoryScores.pattern, 7),
                spatial: toIQ(categoryScores.spatial, 7),
                sequence: toIQ(categoryScores.sequence, 7)
            };
            document.getElementById('score-display').innerText = `Cognitive IQ: ${fallbackIq} (Average Base: 100)`;
            document.getElementById('type-description').innerText = 'Completed analytical session.';
            renderCategoryStats(fallbackCats, '#3b82f6');
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
