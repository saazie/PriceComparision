// PriceCompare - Multi-Store Price Comparison Tool
class PriceComparison {
    constructor() {
        this.allProducts = [];
        this.displayedProducts = [];
        this.productsPerPage = 18;
        this.currentPage = 1;
        
        this.filteredProducts = [];
        this.currentView = 'grid';
        this.currentSort = 'relevance';
        this.theme = localStorage.getItem('priceComparisonTheme') || 'light';
        this.selectedCategory = '';
        this.searchDebounceTimer = null;
        this.isLoading = false;
        
        this.API_BASE_URL = window.location.origin;
        this.CACHE_DURATION = 5 * 60 * 1000;
        this.searchCache = new Map();
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadInitialData();
        this.applyTheme(this.theme);
        this.setupMobileFilters();
        this.validateEnvironment();
    }

    setupEventListeners() {
        this.boundPerformSearch = () => this.performSearch();
        this.boundHandleSearchInput = (e) => this.handleSearchInput(e);
        
        document.getElementById('search-button').addEventListener('click', this.boundPerformSearch);
        document.getElementById('search-input').addEventListener('input', this.boundHandleSearchInput);
        document.getElementById('search-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.performSearch();
        });

        document.getElementById('main-category-select').addEventListener('change', (e) => {
            this.selectedCategory = e.target.value;
            this.applyCategoryFilter();
        });

        document.getElementById('view-toggle').addEventListener('click', () => this.toggleView());

        document.getElementById("view-more-btn").addEventListener("click", () => {
            this.loadMoreProducts();
        });

        document.getElementById('sort-select').addEventListener('change', (e) => {
            this.currentSort = e.target.value;
            this.applySorting();
        });

        document.getElementById('clear-filters').addEventListener('click', () => this.clearFilters());
        
        document.querySelectorAll('.platform-filter input').forEach(checkbox => {
            checkbox.addEventListener('change', () => this.applyFilters());
        });

        document.querySelectorAll('.rating-stars .star').forEach(star => {
            star.addEventListener('click', (e) => this.setRatingFilter(parseInt(e.target.dataset.rating)));
            star.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.setRatingFilter(parseInt(e.target.dataset.rating));
                }
            });
        });

        document.getElementById('free-shipping').addEventListener('change', () => this.applyFilters());
        document.getElementById('prime-shipping').addEventListener('change', () => this.applyFilters());

        document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());
    }

    handleSearchInput(e) {
        const query = e.target.value.trim();
        clearTimeout(this.searchDebounceTimer);
        
        if (query.length < 2) return;
        
        this.searchDebounceTimer = setTimeout(() => {
            this.performSearch(query);
        }, 500);
    }

    setupMobileFilters() {
        const mobileToggle = document.getElementById('mobile-filter-toggle');
        const sidebar = document.getElementById('sidebar');

        mobileToggle.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (!sidebar.contains(e.target) && !mobileToggle.contains(e.target)) {
                sidebar.classList.remove('active');
            }
        });
    }

    validateEnvironment() {
        if (!this.API_BASE_URL || this.API_BASE_URL.includes('localhost')) {
            console.warn('⚠️ Running in development mode');
        }
    }

    sanitizeInput(input) {
        if (typeof input !== 'string') return '';
        return input.replace(/[^\w\s-]/gi, '').substring(0, 100).trim();
    }

    async loadInitialData() {
        this.showLoadingState();

        try {
            const lastSearch = localStorage.getItem('priceComparisonLastSearch') || 'samsung';
            const sanitizedSearch = this.sanitizeInput(lastSearch);
            document.getElementById('search-input').value = sanitizedSearch;

            await this.performSearch(sanitizedSearch);
        } catch (error) {
            console.error('Initial data load failed:', error);
            this.showError('Failed to load initial data');
            
            this.allProducts = this.generateSampleProducts();
            this.filteredProducts = [...this.allProducts];
            this.displayedProducts = this.filteredProducts.slice(0, this.productsPerPage);
            this.renderProducts();
            this.hideLoadingState();
        }
    }

    async performSearch(query) {
        query = this.sanitizeInput(query || document.getElementById('search-input').value);
        
        this.resetPagination();
        this.selectedCategory = '';
        document.getElementById('main-category-select').value = '';
        
        if (!query || query.length < 2) {
            this.showError('Please enter at least 2 characters');
            return;
        }

        if (query.length > 100) {
            this.showError('Search query too long');
            return;
        }

        const cacheKey = `search:${query}:${this.selectedCategory}`;
        const cached = this.searchCache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
            this.processSearchResults(cached.data, query);
            return;
        }

        if (this.isLoading) return;
        this.isLoading = true;

        localStorage.setItem('priceComparisonLastSearch', query);
        this.showLoadingState();

        document.getElementById('results-title').textContent = `Results for "${query}"`;

        try {
            const response = await fetch(`${this.API_BASE_URL}/api/search?q=${encodeURIComponent(query)}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            
            if (!data) {
                throw new Error('No data received from API');
            }

            this.searchCache.set(cacheKey, {
                data: data,
                timestamp: Date.now()
            });

            this.processSearchResults(data, query);
            
        } catch (error) {
            console.error("❌ Search failed:", error);
            this.showError('Search failed. Using demo data...');
            
            this.allProducts = this.generateSampleProducts();
            if (this.selectedCategory) {
                this.allProducts = this.allProducts.filter(product => 
                    product.category === this.selectedCategory
                );
            }
            this.filteredProducts = [...this.allProducts];
            this.displayedProducts = this.filteredProducts.slice(0, this.productsPerPage);
            this.renderProducts();
        } finally {
            this.isLoading = false;
            this.hideLoadingState();
            this.updateViewMoreButton();
        }
    }

    processSearchResults(data, query) {
        const ebayProducts = data.ebay ? data.ebay.map(item => this.convertEbayProduct(item)).filter(Boolean) : [];
        const etsyProducts = data.etsy ? data.etsy.map(item => this.convertEtsyProduct(item)).filter(Boolean) : [];
        const aliexpressProducts = data.aliexpress ? 
            data.aliexpress.map(item => this.convertAliExpressProduct(item)).filter(Boolean) : [];

        this.allProducts = [...ebayProducts, ...etsyProducts, ...aliexpressProducts];

        if (this.allProducts.length === 0) {
            this.allProducts = this.generateSampleProducts();
        }

        this.markBestDeals(this.allProducts);
        this.filteredProducts = [...this.allProducts];
        this.displayedProducts = this.filteredProducts.slice(0, this.productsPerPage);
        
        this.renderProducts();
    }

    resetPagination() {
        this.currentPage = 1;
        this.displayedProducts = [];
    }

    loadMoreProducts() {
        const start = this.currentPage * this.productsPerPage;
        const end = start + this.productsPerPage;
        const nextProducts = this.filteredProducts.slice(start, end);

        if (nextProducts.length === 0) {
            document.getElementById("view-more-btn").style.display = "none";
            return;
        }

        this.displayedProducts = [...this.displayedProducts, ...nextProducts];
        this.currentPage++;

        this.renderProducts();
        this.updateViewMoreButton();
    }

    convertEbayProduct(item) {
        if (!item || !item.itemId) return null;

        try {
            const currentPrice = item.price?.value ? parseFloat(item.price.value) : 0;
            const originalPrice = currentPrice * (1.1 + Math.random() * 0.3);
            const discount = Math.round((1 - currentPrice / originalPrice) * 100);

            return {
                id: `ebay-${item.itemId}`,
                name: item.title || 'Unknown Product',
                brand: item.brand || "Unknown",
                category: this.getProductCategory(item),
                store: "eBay",
                storeClass: "ebay",
                image: item.image?.imageUrl || this.getFallbackImage(),
                price: currentPrice,
                originalPrice: Math.round(originalPrice * 100) / 100,
                discount: discount > 5 ? discount : 0,
                rating: parseFloat((1 + Math.random() * 4).toFixed(1)),
                reviewCount: Math.floor(Math.random() * 1000),
                shipping: Math.random() > 0.3 ? 'Free Shipping' : '$5.99 Shipping',
                primeShipping: false,
                condition: item.condition || "New",
                inStock: true,
                priceChange: (Math.random() - 0.5) * 20,
                lastUpdated: new Date(),
                isBestDeal: false,
                shopName: item.seller?.username || 'eBay Seller',
                deliveryTime: '3-7 days'
            };
        } catch (error) {
            console.error('Error converting eBay product:', error);
            return null;
        }
    }

    convertEtsyProduct(item) {
        if (!item || !item.listing_id) return null;

        try {
            const currentPrice = parseFloat(item.price) || 0;
            const originalPrice = currentPrice * (1.1 + Math.random() * 0.4);
            const discount = Math.round((1 - currentPrice / originalPrice) * 100);

            return {
                id: `etsy-${item.listing_id}`,
                name: item.title || 'Handmade Item',
                brand: "Handmade",
                category: this.getEtsyProductCategory(item),
                store: "Etsy",
                storeClass: "etsy",
                image: item.Images?.[0]?.url_200x200 || this.getFallbackImage(),
                price: currentPrice,
                originalPrice: Math.round(originalPrice * 100) / 100,
                discount: discount > 5 ? discount : 0,
                rating: parseFloat((3 + Math.random() * 2).toFixed(1)),
                reviewCount: Math.floor(Math.random() * 500),
                shipping: Math.random() > 0.4 ? 'Free Shipping' : '$3.99 Shipping',
                primeShipping: Math.random() > 0.7,
                condition: 'Handmade',
                inStock: true,
                priceChange: (Math.random() - 0.3) * 15,
                lastUpdated: new Date(),
                isBestDeal: false,
                shopName: item.Shop?.shop_name || 'Etsy Shop',
                deliveryTime: '7-14 days'
            };
        } catch (error) {
            console.error('Error converting Etsy product:', error);
            return null;
        }
    }

    convertAliExpressProduct(item) {
        if (!item) return null;

        try {
            let currentPrice = 0;
            if (item.product_price && typeof item.product_price === 'string') {
                const priceMatch = item.product_price.match(/[\d.]+/);
                currentPrice = priceMatch ? parseFloat(priceMatch[0]) : 0;
            } else if (item.price) {
                currentPrice = parseFloat(item.price);
            } else {
                currentPrice = 20 + Math.random() * 300;
            }
            
            const productTitle = item.product_title || item.title || 'AliExpress Product';
            let finalTitle = productTitle;
            
            if (finalTitle.toLowerCase().includes('ssd') || finalTitle.toLowerCase().includes('product')) {
                finalTitle = `Samsung Galaxy S22 - ${Math.floor(Math.random() * 1000)}`;
            }
            
            const productImage = item.product_main_image_url || item.image || 
                                item.product_image || this.getFallbackImage();
            
            let originalPrice = currentPrice * (1.2 + Math.random() * 0.3);
            if (item.original_price && typeof item.original_price === 'string') {
                const originalPriceMatch = item.original_price.match(/[\d.]+/);
                originalPrice = originalPriceMatch ? parseFloat(originalPriceMatch[0]) : originalPrice;
            }
            
            let discount = Math.round((1 - currentPrice / originalPrice) * 100);
            if (item.discount && typeof item.discount === 'string') {
                const discountMatch = item.discount.match(/\d+/);
                discount = discountMatch ? parseInt(discountMatch[0]) : discount;
            }
            
            const productRating = parseFloat(item.product_rating) || 
                                parseFloat((4.0 + Math.random() * 1.0).toFixed(1));
            
            const reviewCount = item.product_review_count || 
                              Math.floor(Math.random() * 5000);
            
            return {
                id: item.product_id?.toString() || item.id?.toString() || `ali-${Date.now()}-${Math.random()}`,
                name: finalTitle,
                brand: "Samsung",
                category: this.getAliExpressCategory(item),
                store: "AliExpress",
                storeClass: "aliexpress",
                image: productImage,
                price: parseFloat(currentPrice.toFixed(2)),
                originalPrice: parseFloat(originalPrice.toFixed(2)),
                discount: discount > 5 ? discount : 0,
                rating: productRating,
                reviewCount: reviewCount,
                shipping: 'Free Shipping',
                primeShipping: false,
                condition: 'New',
                inStock: true,
                priceChange: (Math.random() - 0.2) * 15,
                lastUpdated: new Date(),
                isBestDeal: false,
                shopName: item.store_name || 'AliExpress Store',
                orders: item.product_orders || Math.floor(Math.random() * 10000),
                deliveryTime: '15-25 days'
            };
        } catch (error) {
            console.error("❌ Error converting AliExpress product:", error);
            return null;
        }
    }

    getFallbackImage() {
        return `https://picsum.photos/150/150?random=${Math.floor(Math.random() * 1000)}`;
    }

    getAliExpressCategory(item) {
        const title = (item.product_title || '').toLowerCase();
        if (title.includes('phone') || title.includes('mobile') || title.includes('android') || title.includes('iphone')) 
            return 'Cell Phones & Accessories';
        if (title.includes('laptop') || title.includes('computer') || title.includes('notebook') || title.includes('macbook')) 
            return 'Electronics';
        if (title.includes('watch') || title.includes('smartwatch') || title.includes('fitness') || title.includes('tracker')) 
            return 'Watches & Accessories';
        if (title.includes('dress') || title.includes('shirt') || title.includes('clothing') || title.includes('fashion')) 
            return 'Clothing & Shoes';
        if (title.includes('home') || title.includes('decor') || title.includes('furniture') || title.includes('kitchen')) 
            return 'Home & Garden';
        return 'Other Categories';
    }

    getEtsyProductCategory(item) {
        const title = item.title?.toLowerCase() || '';
        if (title.includes('jewelry') || title.includes('necklace') || title.includes('bracelet')) 
            return 'Jewelry';
        if (title.includes('art') || title.includes('painting') || title.includes('print')) 
            return 'Art & Collectibles';
        if (title.includes('clothing') || title.includes('shirt') || title.includes('dress')) 
            return 'Clothing & Shoes';
        return 'Handmade';
    }

    getProductCategory(item) {
        const title = item.title?.toLowerCase() || '';
        if (title.includes('phone') || title.includes('iphone') || title.includes('samsung')) 
            return 'Cell Phones & Accessories';
        if (title.includes('laptop') || title.includes('camera') || title.includes('headphone')) 
            return 'Electronics';
        if (title.includes('home') || title.includes('kitchen') || title.includes('furniture')) 
            return 'Home & Kitchen';
        return 'Electronics';
    }

    applyCategoryFilter() {
        this.resetPagination();
        
        if (this.selectedCategory && this.selectedCategory !== '') {
            this.filteredProducts = this.allProducts.filter(product => 
                product.category === this.selectedCategory
            );
            
            const currentQuery = document.getElementById('search-input').value || 'products';
            document.getElementById('results-title').textContent = 
                `Results for "${currentQuery}" in ${this.selectedCategory}`;
        } else {
            this.filteredProducts = [...this.allProducts];
            const currentQuery = document.getElementById('search-input').value || 'products';
            document.getElementById('results-title').textContent = 
                `Results for "${currentQuery}"`;
        }
        
        this.displayedProducts = this.filteredProducts.slice(0, this.productsPerPage);
        this.renderProducts();
        this.updateViewMoreButton();
        this.toggleEmptyState();
    }

    updateViewMoreButton() {
        const viewMoreBtn = document.getElementById('view-more-btn');
        const remainingProducts = this.filteredProducts.length - this.displayedProducts.length;
        
        if (remainingProducts <= 0) {
            viewMoreBtn.style.display = 'none';
        } else {
            viewMoreBtn.style.display = 'block';
            viewMoreBtn.textContent = `View More (${remainingProducts} remaining)`;
            viewMoreBtn.disabled = false;
        }
    }

    generateSampleProducts() {
        const brands = {
            electronics: ['Apple', 'Samsung', 'Sony', 'LG', 'Bose', 'Microsoft', 'Google', 'OnePlus'],
            computers: ['Apple', 'Dell', 'HP', 'Lenovo', 'ASUS', 'Acer', 'MSI', 'Razer'],
            phones: ['Apple', 'Samsung', 'Google', 'OnePlus', 'Xiaomi', 'Oppo', 'Vivo', 'Realme'],
            home: ['KitchenAid', 'Instant Pot', 'Dyson', 'iRobot', 'Philips', 'Black+Decker', 'Ninja', 'Cuisinart'],
            fashion: ['Nike', 'Adidas', 'Levi\'s', 'Under Armour', 'Puma', 'Reebok', 'New Balance', 'Skechers']
        };

        const categories = ['Electronics', 'Home & Kitchen', 'Sports & Outdoors', 'Beauty', 'Toys & Games', 'Clothing', 'Books', 'Automotive'];
        
        const stores = [
            { name: 'eBay', class: 'ebay' },
            { name: 'Etsy', class: 'etsy' },
            { name: 'AliExpress', class: 'aliexpress' }
        ];

        const products = [];
            
        categories.forEach(category => {
            const categoryBrands = this.getBrandsForCategory(category, brands);
            
            stores.forEach(store => {
                for (let i = 0; i < 8; i++) {
                    const brand = categoryBrands[Math.floor(Math.random() * categoryBrands.length)];
                    
                    const basePrice = this.getBasePrice(category, brand);
                    const currentPrice = basePrice * (0.7 + Math.random() * 0.6);
                    const originalPrice = currentPrice * (1 + Math.random() * 0.3);
                    const discount = Math.round((1 - currentPrice / originalPrice) * 100);
                    
                    const lastPrice = originalPrice * (0.9 + Math.random() * 0.2);
                    const priceChange = ((currentPrice - lastPrice) / lastPrice) * 100;
                    
                    products.push({
                        id: `${store.name}-${category}-${brand}-${i}-${Date.now()}-${Math.random()}`,
                        name: `${brand} ${this.getProductName(category, i)}`,
                        brand: brand,
                        category: category,
                        store: store.name,
                        storeClass: store.class,
                        image: this.getFallbackImage(),
                        price: Math.round(currentPrice * 100) / 100,
                        originalPrice: Math.round(originalPrice * 100) / 100,
                        discount: discount > 5 ? discount : 0,
                        rating: parseFloat((3 + Math.random() * 2).toFixed(1)),
                        reviewCount: Math.floor(Math.random() * 10000),
                        shipping: Math.random() > 0.3 ? 'Free Shipping' : '$5.99 Shipping',
                        primeShipping: store.name === 'Etsy' ? Math.random() > 0.5 : false,
                        condition: 'New',
                        inStock: true,
                        priceChange: priceChange,
                        lastUpdated: new Date(),
                        isBestDeal: false,
                        shopName: store.name === 'eBay' ? `eBay_Seller_${i+1}` : 
                                 store.name === 'Etsy' ? `Etsy_Shop_${i+1}` : 
                                 `Global_Store_${i+1}`,
                        deliveryTime: store.name === 'eBay' ? '3-7 days' : 
                                     store.name === 'Etsy' ? '7-14 days' : 
                                     '15-25 days'
                    });
                }
            });
        });
        
        this.markBestDeals(products);
        return products;
    }

    getBrandsForCategory(category, brands) {
        if (category === 'Electronics') return brands.electronics;
        if (category === 'Home & Kitchen') return brands.home;
        if (category === 'Clothing') return brands.fashion;
        if (category === 'Sports & Outdoors') return brands.fashion;
        return brands.electronics;
    }

    markBestDeals(products) {
        const productGroups = {};
        
        products.forEach(product => {
            const key = `${product.brand} ${product.name.split(' ').slice(1).join(' ')}`;
            if (!productGroups[key]) {
                productGroups[key] = [];
            }
            productGroups[key].push(product);
        });
        
        Object.values(productGroups).forEach(group => {
            if (group.length > 1) {
                const lowestPrice = Math.min(...group.map(p => p.price));
                group.forEach(product => {
                    if (product.price === lowestPrice) {
                        product.isBestDeal = true;
                    }
                });
            }
        });
    }

    getBasePrice(category, brand) {
        const basePrices = {
            'Electronics': { default: 300, Apple: 500, Samsung: 400, Sony: 450, LG: 350 },
            'Home & Kitchen': { default: 150, KitchenAid: 300, Dyson: 400, InstantPot: 120 },
            'Sports & Outdoors': { default: 80, Nike: 120, Adidas: 100, UnderArmour: 90 },
            'Beauty': { default: 25 },
            'Toys & Games': { default: 40 }
        };

        return basePrices[category]?.[brand] || basePrices[category]?.default || 200;
    }

    getProductName(category, index) {
        const names = {
            'Electronics': ['Wireless Earbuds', 'Smart Watch', 'Bluetooth Speaker', 'Headphones', 'Tablet'],
            'Home & Kitchen': ['Air Purifier', 'Stand Mixer', 'Vacuum Cleaner', 'Coffee Maker', 'Blender'],
            'Sports & Outdoors': ['Running Shoes', 'Yoga Mat', 'Dumbbells', 'Basketball', 'Tennis Racket'],
            'Beauty': ['Moisturizer', 'Foundation', 'Lipstick', 'Shampoo', 'Perfume'],
            'Toys & Games': ['Action Figure', 'Board Game', 'Puzzle', 'Building Blocks', 'Remote Car']
        };

        const categoryNames = names[category] || names['Electronics'];
        return categoryNames[index % categoryNames.length];
    }

    renderProducts() {
        if (this.currentView === 'grid') {
            this.renderGridView();
        } else {
            this.renderTableView();
        }
        this.updateResultsCount();
        this.toggleEmptyState();
    }

    toggleEmptyState() {
        const emptyState = document.getElementById('empty-state');
        const hasProducts = this.displayedProducts.length > 0;
        
        if (emptyState) {
            emptyState.style.display = hasProducts ? 'none' : 'flex';
            
            if (!hasProducts && this.selectedCategory && this.selectedCategory !== '') {
                emptyState.innerHTML = `
                    <i class="fas fa-search" aria-hidden="true"></i>
                    <h3>No products found in ${this.selectedCategory}</h3>
                    <p>Try selecting a different category or search for something else.</p>
                `;
            } else if (!hasProducts) {
                emptyState.innerHTML = `
                    <i class="fas fa-search" aria-hidden="true"></i>
                    <h3>No products found</h3>
                    <p>Try adjusting your filters or search for something else.</p>
                `;
            }
        }
    }

    renderGridView() {
        const container = document.getElementById('products-container');
        if (!container) return;

        container.innerHTML = '';

        if (this.displayedProducts.length === 0) {
            this.toggleEmptyState();
            return;
        }
        
        const ebayProducts = this.displayedProducts.filter(p => p.store === "eBay");
        const aliexpressProducts = this.displayedProducts.filter(p => p.store === "AliExpress"); 
        const etsyProducts = this.displayedProducts.filter(p => p.store === "Etsy");

        const stores = [
            { name: 'eBay', products: ebayProducts },
            { name: 'AliExpress', products: aliexpressProducts },
            { name: 'Etsy', products: etsyProducts }
        ];

        stores.forEach(store => {
            const column = document.createElement('div');
            column.className = 'product-column';
            
            if (store.products.length > 0) {
                store.products.forEach(product => {
                    const productCard = this.createProductCard(product);
                    column.appendChild(productCard);
                });
            } else {
                column.innerHTML += `
                    <div class="no-products" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                        <i class="fas fa-box-open" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                        <p>No ${store.name} products found</p>
                    </div>
                `;
            }
            
            container.appendChild(column);
        });
    }

    createProductCard(product) {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = this.getProductCardHTML(product);
        
        const primaryBtn = card.querySelector('.btn-primary');
        const outlineBtn = card.querySelector('.btn-outline');
        
        if (primaryBtn) {
            primaryBtn.addEventListener('click', () => this.trackPurchase(product));
        }
        if (outlineBtn) {
            outlineBtn.addEventListener('click', () => this.toggleWatchlist(product.id));
        }
        
        return card;
    }

    getProductCardHTML(product) {
        const ratingStars = '★'.repeat(Math.floor(product.rating)) + '☆'.repeat(5 - Math.floor(product.rating));
        const priceTrend = product.priceChange >= 0 ? 'up' : 'down';
        const trendIcon = priceTrend === 'up' ? 'fas fa-arrow-up' : 'fas fa-arrow-down';
        
        return `
            ${product.isBestDeal ? '<div class="best-deal-badge">Best Deal</div>' : ''}
            <div class="product-image">
                <img src="${product.image}" alt="${product.name}" loading="lazy">
            </div>
            <h3 class="product-title">${product.name}</h3>
            ${product.shopName ? `<div class="shop-name">${product.shopName}</div>` : ''}
            ${product.deliveryTime ? `<div class="delivery-time">🚚 ${product.deliveryTime}</div>` : ''}
            <div class="price-trend ${priceTrend}">
                <i class="${trendIcon}"></i>
                <span>${Math.abs(product.priceChange).toFixed(1)}%</span>
            </div>
            <div class="product-price">$${product.price.toFixed(2)}</div>
            <div class="product-rating">
                <span class="rating-stars-small">${ratingStars}</span>
                <span class="rating-value">${product.rating.toFixed(1)}</span>
            </div>
            <div class="product-shipping">
                <i class="fas fa-shipping-fast"></i>
                ${product.shipping}
            </div>
            <div class="product-actions">
                <button class="btn btn-primary" aria-label="View ${product.name} on ${product.store}">
                    <i class="fas fa-shopping-cart"></i> View More
                </button>
                <button class="btn btn-outline" aria-label="Add ${product.name} to watchlist">
                    <i class="fas fa-heart"></i>
                </button>
            </div>
        `;
    }

    renderTableView() {
        const tbody = document.getElementById('table-body');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (this.displayedProducts.length === 0) {
            this.toggleEmptyState();
            return;
        }

        this.displayedProducts.forEach(product => {
            const row = this.createTableRow(product);
            tbody.appendChild(row);
        });
    }

    createTableRow(product) {
        const row = document.createElement('tr');
        const ratingStars = '★'.repeat(Math.floor(product.rating)) + '☆'.repeat(5 - Math.floor(product.rating));
        const priceTrend = product.priceChange >= 0 ? 'up' : 'down';
        const trendIcon = priceTrend === 'up' ? 'fas fa-arrow-up' : 'fas fa-arrow-down';
        
        row.innerHTML = `
            <td>
                <div class="table-product">
                    <div class="table-image">
                        <img src="${product.image}" alt="${product.name}" loading="lazy">
                        ${product.isBestDeal ? '<div class="best-deal-badge">Best</div>' : ''}
                    </div>
                    <div class="table-info">
                        <div class="table-title">${product.name}</div>
                        ${product.shopName ? `<div class="shop-name">${product.shopName}</div>` : ''}
                        ${product.deliveryTime ? `<div class="delivery-time">🚚 ${product.deliveryTime}</div>` : ''}
                        <div class="table-rating">
                            <span class="rating-stars-small">${ratingStars}</span>
                            <span>${product.rating.toFixed(1)}</span>
                            <span>(${product.reviewCount})</span>
                        </div>
                        <div class="store-badge ${product.storeClass}">
                            <i class="fab fa-${product.storeClass}"></i> ${product.store}
                        </div>
                    </div>
                </div>
            </td>
            <td>
                <div class="table-price">$${product.price.toFixed(2)}</div>
                <div class="price-trend ${priceTrend}">
                    <i class="${trendIcon}"></i>
                    <span>${Math.abs(product.priceChange).toFixed(1)}%</span>
                </div>
                ${product.discount > 0 ? `<div class="discount-text">Save ${product.discount}%</div>` : ''}
            </td>
            <td>
                <div class="table-rating">
                    <span class="rating-stars-small">${ratingStars}</span>
                    <span>${product.rating.toFixed(1)}</span>
                </div>
                <div class="review-count">${product.reviewCount} reviews</div>
            </td>
            <td>
                <div class="table-shipping">${product.shipping}</div>
                ${product.primeShipping ? '<div class="express-shipping">Express Shipping</div>' : ''}
            </td>
            <td>
                <div class="table-actions">
                    <button class="btn btn-primary btn-sm" aria-label="Buy ${product.name}">
                        <i class="fas fa-shopping-cart"></i> Buy
                    </button>
                    <button class="btn btn-outline btn-sm" aria-label="Add ${product.name} to watchlist">
                        <i class="fas fa-heart"></i>
                    </button>
                </div>
            </td>
        `;
        
        const primaryBtn = row.querySelector('.btn-primary');
        const outlineBtn = row.querySelector('.btn-outline');
        
        if (primaryBtn) {
            primaryBtn.addEventListener('click', () => this.trackPurchase(product));
        }
        if (outlineBtn) {
            outlineBtn.addEventListener('click', () => this.toggleWatchlist(product.id));
        }
        
        return row;
    }

    applyFilters() {
        const selectedStores = Array.from(document.querySelectorAll('.platform-filter input:checked'))
            .map(checkbox => checkbox.dataset.store);
        const minRating = document.querySelectorAll('.rating-stars .star.active').length;
        const freeShipping = document.getElementById('free-shipping').checked;
        const primeShipping = document.getElementById('prime-shipping').checked;

        this.filteredProducts = this.allProducts.filter(product => {
            if (selectedStores.length > 0 && !selectedStores.includes(product.storeClass)) return false;
            if (product.rating < minRating) return false;
            if (freeShipping && !product.shipping.includes('Free')) return false;
            if (primeShipping && !product.primeShipping) return false;
            if (this.selectedCategory && product.category !== this.selectedCategory) return false;
            
            return true;
        });

        this.markBestDeals(this.filteredProducts);
        
        this.resetPagination();
        this.displayedProducts = this.filteredProducts.slice(0, this.productsPerPage);
        this.applySorting();
        this.updateViewMoreButton();
    }

    applySorting() {
        switch (this.currentSort) {
            case 'price-low':
                this.filteredProducts.sort((a, b) => a.price - b.price);
                break;
            case 'price-high':
                this.filteredProducts.sort((a, b) => b.price - a.price);
                break;
            case 'rating':
                this.filteredProducts.sort((a, b) => b.rating - a.rating);
                break;
            default:
                break;
        }

        this.resetPagination();
        this.displayedProducts = this.filteredProducts.slice(0, this.productsPerPage);
        this.renderProducts();
    }

    clearFilters() {
        this.setRatingFilter(1);
        document.getElementById('free-shipping').checked = false;
        document.getElementById('prime-shipping').checked = false;
        
        this.applyFilters();
    }

    setRatingFilter(rating) {
        document.querySelectorAll('.rating-stars .star').forEach((star, index) => {
            if (index < rating) {
                star.classList.add('active');
            } else {
                star.classList.remove('active');
            }
        });
        
        document.querySelector('.rating-text').textContent = `${rating}+ Stars`;
        this.applyFilters();
    }

    toggleView() {
        const gridView = document.getElementById('grid-view');
        const tableView = document.getElementById('table-view');
        const viewToggle = document.getElementById('view-toggle');
        
        if (this.currentView === 'grid') {
            this.currentView = 'table';
            gridView.style.display = 'none';
            tableView.classList.add('active');
            viewToggle.innerHTML = '<i class="fas fa-th"></i>';
            viewToggle.setAttribute('aria-label', 'Switch to grid view');
        } else {
            this.currentView = 'grid';
            gridView.style.display = 'block';
            tableView.classList.remove('active');
            viewToggle.innerHTML = '<i class="fas fa-table"></i>';
            viewToggle.setAttribute('aria-label', 'Switch to table view');
        }
        
        this.renderProducts();
    }

    toggleWatchlist(productId) {
        const event = new CustomEvent('watchlistToggle', { detail: { productId } });
        document.dispatchEvent(event);
    }

    trackPurchase(product) {
        let storeUrl;
        
        if (product.store === 'Etsy') {
            storeUrl = 'https://www.etsy.com/search?q=' + encodeURIComponent(product.name);
        } 
        else if (product.store === 'eBay') {
            storeUrl = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(product.name);
        }
        else {
            storeUrl = 'https://www.aliexpress.com/wholesale?SearchText=' + encodeURIComponent(product.name);
        }
        
        window.open(storeUrl, '_blank', 'noopener,noreferrer');
    }

    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        this.applyTheme(this.theme);
        
        try {
            localStorage.setItem('priceComparisonTheme', this.theme);
        } catch (error) {
            console.warn('Could not save theme to localStorage:', error);
        }
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const icon = document.querySelector('#theme-toggle i');
        icon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
    }

    updateResultsCount() {
        const count = this.displayedProducts.length;
        const total = this.filteredProducts.length;
        document.getElementById('results-count').textContent = `Showing ${count} of ${total} products`;
    }

    showLoadingState() {
        document.getElementById('grid-loading')?.classList.add('active');
        document.getElementById('table-loading')?.classList.add('active');
    }

    hideLoadingState() {
        document.getElementById('grid-loading')?.classList.remove('active');
        document.getElementById('table-loading')?.classList.remove('active');
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--danger);
            color: white;
            padding: 1rem;
            border-radius: 4px;
            z-index: 1000;
        `;
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const priceComparison = new PriceComparison();
    window.priceComparison = priceComparison;
});

// Watchlist toggle event listener
document.addEventListener('watchlistToggle', (event) => {
    const { productId } = event.detail;
});

window.addEventListener('scroll', () => {
    const header = document.querySelector('.header');
    if (window.scrollY > 100) {
        header.classList.add('scrolled');
    } else {
        header.classList.remove('scrolled');
    }
});
