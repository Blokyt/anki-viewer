/**
 * Anki Library - Main Application JavaScript
 */

// Global state
let appState = {
    decks: [],
    cards: [],
    cardCountByDeck: {},  // Computed: deckId -> count
    currentDeck: null,
    searchQuery: '',
    displayedCards: [],
    currentModalCard: null // Track currently open card
};

// DOM Elements
const elements = {};

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    cacheElements();
    setupEventListeners();
    await loadData();
});

/**
 * Cache DOM elements for better performance
 */
function cacheElements() {
    elements.searchInput = document.getElementById('searchInput');
    elements.clearSearch = document.getElementById('clearSearch');
    elements.exportJSON = document.getElementById('exportJSON');
    elements.deckTree = document.getElementById('deckTree');
    elements.cardsGrid = document.getElementById('cardsGrid');
    elements.currentDeckName = document.getElementById('currentDeckName');
    elements.currentDeckPath = document.getElementById('currentDeckPath');
    elements.totalDecks = document.getElementById('totalDecks');
    elements.totalCards = document.getElementById('totalCards');
    elements.modalOverlay = document.getElementById('modalOverlay');
    elements.modalFront = document.getElementById('modalFront');
    elements.modalBack = document.getElementById('modalBack');
    elements.modalClose = document.getElementById('modalClose');
    elements.copyJSON = document.getElementById('copyJSON');
    elements.collapseAll = document.getElementById('collapseAll');
    elements.resizeHandle = document.getElementById('resizeHandle');
    elements.sidebar = document.getElementById('sidebar');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Search
    elements.searchInput.addEventListener('input', debounce(handleSearch, 300));
    elements.clearSearch.addEventListener('click', clearSearch);

    // Export
    if (elements.exportJSON) {
        elements.exportJSON.addEventListener('click', exportFilteredCards);
    }

    // Modal
    elements.modalClose.addEventListener('click', closeModal);
    elements.modalOverlay.addEventListener('click', (e) => {
        if (e.target === elements.modalOverlay) closeModal();
    });

    // Copy JSON
    if (elements.copyJSON) {
        elements.copyJSON.addEventListener('click', copyCurrentCardJSON);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboard);

    // Collapse all decks
    elements.collapseAll.addEventListener('click', collapseAllDecks);

    // Resize sidebar
    setupResizer();
}

/**
 * Compute card counts per deck from cards array
 */
function computeCardCounts() {
    appState.cardCountByDeck = {};
    appState.deckById = {};  // Map deckId -> deck node

    // Build deck lookup map
    function buildDeckMap(deck) {
        appState.deckById[deck.id] = deck;
        for (const child of deck.children || []) {
            buildDeckMap(child);
        }
    }
    for (const deck of appState.decks) {
        buildDeckMap(deck);
    }

    // Count cards per deck
    for (const card of appState.cards) {
        const deckId = card.deckId;
        appState.cardCountByDeck[deckId] = (appState.cardCountByDeck[deckId] || 0) + 1;
    }

    // Update the deck tree with counts
    function updateDeckCounts(deck) {
        const directCount = appState.cardCountByDeck[deck.id] || 0;
        let totalCount = directCount;

        for (const child of deck.children || []) {
            totalCount += updateDeckCounts(child);
        }

        deck.cardCount = directCount;
        deck.totalCards = totalCount;
        return totalCount;
    }

    for (const deck of appState.decks) {
        updateDeckCounts(deck);
    }
}

/**
 * Count total number of decks in tree
 */
function countDecks(decks) {
    let count = 0;
    function countNode(node) {
        count++;
        for (const child of node.children || []) {
            countNode(child);
        }
    }
    for (const deck of decks) {
        countNode(deck);
    }
    return count;
}

/**
 * Load data from JSON file
 */
async function loadData() {
    try {
        const response = await fetch('data.json');
        if (!response.ok) {
            throw new Error('Impossible de charger data.json. Exécutez d\'abord anki_to_json.py');
        }

        const data = await response.json();
        appState.decks = data.decks || [];
        appState.cards = data.cards || [];

        // Compute card counts per deck
        computeCardCounts();

        // Update stats
        elements.totalDecks.textContent = countDecks(appState.decks);
        elements.totalCards.textContent = appState.cards.length;

        // Render deck tree
        renderDeckTree();

    } catch (error) {
        console.error('Error loading data:', error);
        elements.deckTree.innerHTML = `
            <div class="empty-state" style="padding: 20px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <h3 style="margin-bottom: 8px;">Données non trouvées</h3>
                <p style="font-size: 0.85rem; color: var(--text-muted);">
                    Exécutez d'abord:<br>
                    <code style="background: var(--bg-tertiary); padding: 4px 8px; border-radius: 4px; margin-top: 8px; display: inline-block;">python anki_to_json.py</code>
                </p>
            </div>
        `;
    }
}

/**
 * Render the deck tree in the sidebar
 */
function renderDeckTree() {
    elements.deckTree.innerHTML = '';

    if (appState.decks.length === 0) {
        elements.deckTree.innerHTML = '<p class="empty-state">Aucun deck trouvé</p>';
        return;
    }

    // Add "All Cards" option
    const allCardsNode = createDeckNode({
        id: 'all',
        name: 'Toutes les cartes',
        fullPath: '',
        children: [],
        totalCards: appState.cards.length
    }, true);
    elements.deckTree.appendChild(allCardsNode);

    // Render deck tree
    appState.decks.forEach(deck => {
        const node = createDeckNode(deck);
        elements.deckTree.appendChild(node);
    });
}

/**
 * Create a deck node element
 */
function createDeckNode(deck, isSpecial = false) {
    const node = document.createElement('div');
    node.className = 'deck-node';

    const hasChildren = deck.children && deck.children.length > 0;

    const item = document.createElement('div');
    item.className = 'deck-item';
    item.dataset.deckId = deck.id;
    item.dataset.fullPath = deck.fullPath || '';

    item.innerHTML = `
        <div class="deck-toggle ${hasChildren ? '' : 'empty'}">
            ${hasChildren ? `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            ` : ''}
        </div>
        <svg class="deck-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${isSpecial ?
            '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>' :
            '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>'
        }
        </svg>
        <span class="deck-name" title="${deck.name}">${deck.name}</span>
        <span class="deck-count">${deck.totalCards || 0}</span>
    `;

    // Click handler for deck selection - clicking anywhere selects AND expands
    item.addEventListener('click', (e) => {
        selectDeck(deck, item);
        if (hasChildren) {
            toggleDeckExpand(item, node);
        }
    });

    node.appendChild(item);

    // Add children
    if (hasChildren) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'deck-children collapsed';

        deck.children.forEach(child => {
            childrenContainer.appendChild(createDeckNode(child));
        });

        node.appendChild(childrenContainer);
    }

    return node;
}

/**
 * Toggle deck expansion
 */
function toggleDeckExpand(item, node) {
    const toggle = item.querySelector('.deck-toggle');
    const children = node.querySelector('.deck-children');

    if (children) {
        toggle.classList.toggle('expanded');
        children.classList.toggle('collapsed');
    }
}

/**
 * Select a deck and display its cards
 */
function selectDeck(deck, itemElement) {
    // Update active state
    document.querySelectorAll('.deck-item').forEach(el => el.classList.remove('active'));
    itemElement.classList.add('active');

    appState.currentDeck = deck;

    // Update header
    elements.currentDeckName.textContent = deck.name;
    elements.currentDeckPath.textContent = deck.fullPath || 'Toutes les cartes';

    // Filter and display cards
    filterAndDisplayCards();
}


/**
 * Filter and display cards based on current filters
 */
function filterAndDisplayCards() {
    let cards = [...appState.cards];

    // Filter by deck
    if (appState.currentDeck && appState.currentDeck.id !== 'all') {
        const deckPath = appState.currentDeck.fullPath;
        cards = cards.filter(card => {
            const cardDeckPath = appState.deckById[card.deckId]?.fullPath || '';
            return cardDeckPath === deckPath || cardDeckPath.startsWith(deckPath + '::');
        });
    }

    // Filter by search
    if (appState.searchQuery) {
        const searchTerms = appState.searchQuery.toLowerCase().split(' ').filter(t => t);
        cards = cards.filter(card => {
            const content = (card.frontClean + ' ' + card.backClean).toLowerCase();
            return searchTerms.every(term => content.includes(term));
        });
    }

    appState.displayedCards = cards;
    renderCards(cards);
}

/**
 * Render cards in the grid
 */
function renderCards(cards) {
    elements.cardsGrid.innerHTML = '';

    if (cards.length === 0) {
        elements.cardsGrid.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="12" y1="18" x2="12" y2="12"></line>
                    <line x1="9" y1="15" x2="15" y2="15"></line>
                </svg>
                <h3>Aucune carte trouvée</h3>
                <p>Essayez de modifier vos filtres ou votre recherche</p>
            </div>
        `;
        return;
    }

    // Limit initial render for performance
    const cardsToRender = cards.slice(0, 100);

    cardsToRender.forEach(card => {
        const cardElement = createCardElement(card);
        elements.cardsGrid.appendChild(cardElement);
    });

    // Show count if limited
    if (cards.length > 100) {
        const moreInfo = document.createElement('div');
        moreInfo.className = 'empty-state';
        moreInfo.innerHTML = `<p>Affichage de 100 cartes sur ${cards.length}. Utilisez la recherche pour filtrer.</p>`;
        elements.cardsGrid.appendChild(moreInfo);
    }

    // Trigger MathJax rendering
    if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([elements.cardsGrid]).catch(err => console.log('MathJax error:', err));
    }
}

/**
 * Create a card element
 */
function createCardElement(card) {
    const element = document.createElement('div');
    element.className = 'card-item';

    // Create preview (show front content)  
    const preview = document.createElement('div');
    preview.className = 'card-preview';

    // Use card.front for proper rendering, fallback to clean/text if needed
    let content = card.front || card.frontClean || 'Pas de contenu';

    // Highlight search terms if searching
    if (appState.searchQuery) {
        content = highlightTextSafe(content, appState.searchQuery);
        preview.innerHTML = content;
    } else {
        // If no search, use innerHTML to render HTML/LaTeX properly
        preview.innerHTML = content;
    }

    element.appendChild(preview);

    // Click to open modal
    element.addEventListener('click', () => openCardModal(card));

    return element;
}

/**
 * Helper to highlight text safely ignoring HTML tags and LaTeX
 */
function highlightTextSafe(content, query) {
    if (!query) return content;

    // Convert query specific terms to array
    const terms = query.toLowerCase().split(/\s+/).filter(t => t);
    if (terms.length === 0) return content;

    // Create a single regex for all terms to avoid recursive highlighting
    // Sort by length desc to match longest terms first
    terms.sort((a, b) => b.length - a.length);

    const escapedTerms = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const termsPattern = escapedTerms.join('|');

    // Regex for matching terms (case insensitive)
    const termsRegex = new RegExp(`(${termsPattern})`, 'gi');
    // Regex for LaTeX Highlighting: avoid matches preceded by backslash
    const latexTermsRegex = new RegExp(`(?<!\\\\)(${termsPattern})`, 'gi');

    // Pattern to split content:
    // 1. HTML Tags
    // 2. LaTeX Blocks
    const splitPattern = /(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|<[^>]+>)/g;

    const parts = content.split(splitPattern);

    return parts.map(part => {
        // 1. HTML Tags -> Return as is
        if (part.startsWith('<')) {
            return part;
        }

        // 2. LaTeX Blocks -> Use {\class{search-highlight}{term}}
        // Wrapping in braces {} ensures it works even as an argument to commands like \vec{}, ^, or _ without breaking syntax
        if (part.startsWith('\\(') || part.startsWith('\\[')) {
            try {
                // Use single-pass replacement for all terms
                return part.replace(latexTermsRegex, '{\\class{search-highlight}{$1}}');
            } catch (e) {
                return part; // Fallback if regex fails
            }
        }

        // 3. Normal Text -> Use <mark>term</mark>
        return part.replace(termsRegex, '<mark>$1</mark>');
    }).join('');
}

/**
 * Open card modal
 */
function openCardModal(card) {
    appState.currentModalCard = card; // Store current card

    // Apply highlighting to modal content as well
    let frontContent = card.front;
    let backContent = card.back;

    if (appState.searchQuery) {
        frontContent = highlightTextSafe(frontContent, appState.searchQuery);
        backContent = highlightTextSafe(backContent, appState.searchQuery);
    }

    elements.modalFront.innerHTML = frontContent;
    elements.modalBack.innerHTML = backContent;

    elements.modalOverlay.classList.add('visible');
    document.body.style.overflow = 'hidden';

    // Trigger MathJax rendering in modal
    if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([elements.modalOverlay]).catch(err => console.log('MathJax error:', err));
    }
}

/**
 * Close card modal
 */
function closeModal() {
    appState.currentModalCard = null; // Clear current card
    elements.modalOverlay.classList.remove('visible');
    document.body.style.overflow = '';
}

/**
 * Handle search input
 */
function handleSearch(e) {
    appState.searchQuery = e.target.value.trim();
    filterAndDisplayCards();
}

/**
 * Clear search
 */
function clearSearch() {
    elements.searchInput.value = '';
    appState.searchQuery = '';
    filterAndDisplayCards();
}

/**
 * Handle keyboard shortcuts
 */
function handleKeyboard(e) {
    // Escape to close modal
    if (e.key === 'Escape') {
        closeModal();
    }

    // Ctrl/Cmd + K for search focus
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        elements.searchInput.focus();
    }
}

/**
 * Collapse all decks
 */
function collapseAllDecks() {
    document.querySelectorAll('.deck-toggle.expanded').forEach(toggle => {
        toggle.classList.remove('expanded');
    });
    document.querySelectorAll('.deck-children').forEach(children => {
        children.classList.add('collapsed');
    });
}

/**
 * Setup sidebar resizer
 */
function setupResizer() {
    let isResizing = false;

    elements.resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const newWidth = e.clientX;
        if (newWidth >= 200 && newWidth <= 500) {
            elements.sidebar.style.width = newWidth + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
}

/**
 * Export filtered cards to JSON
 */
function exportFilteredCards() {
    const cardsToExport = appState.displayedCards;

    if (!cardsToExport || cardsToExport.length === 0) {
        alert('Aucune carte à exporter.');
        return;
    }

    const dataStr = JSON.stringify(cardsToExport, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = 'anki_export.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

/**
 * Copy current modal card JSON to clipboard
 */
async function copyCurrentCardJSON() {
    if (!appState.currentModalCard) return;

    const data = JSON.stringify(appState.currentModalCard, null, 2);

    try {
        await navigator.clipboard.writeText(data);

        // Visual feedback
        const originalText = elements.copyJSON.innerHTML;
        elements.copyJSON.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Copié !</span>
        `;
        elements.copyJSON.style.borderColor = '#10B981'; // Green
        elements.copyJSON.style.color = '#10B981';

        setTimeout(() => {
            elements.copyJSON.innerHTML = originalText;
            elements.copyJSON.style.borderColor = '';
            elements.copyJSON.style.color = '';
        }, 2000);

    } catch (err) {
        console.error('Failed to copy text: ', err);
        alert('Erreur lors de la copie');
    }
}

/**
 * Debounce utility
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
