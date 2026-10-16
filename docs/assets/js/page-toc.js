// "On this page" panel: lists the article's h2/h3 sections and highlights the one in view.
// The theme has no right-side table of contents; layout lives in _sass/custom/custom.scss.
(function () {
    'use strict';

    function init() {
        var wrap = document.querySelector('.main-content-wrap');
        var main = document.querySelector('#main-content main');
        if (!wrap || !main) {
            return;
        }

        var headings = Array.prototype.filter.call(main.querySelectorAll('h2[id], h3[id]'), function (h) {
            return !h.closest('.no_toc') && !h.classList.contains('no_toc');
        });
        if (headings.length < 3) {
            return;
        }

        var aside = document.createElement('aside');
        aside.className = 'page-toc';
        aside.setAttribute('aria-labelledby', 'page-toc-title');

        var title = document.createElement('p');
        title.className = 'page-toc-title';
        title.id = 'page-toc-title';
        title.textContent = 'On this page';
        aside.appendChild(title);

        var list = document.createElement('ul');
        var links = headings.map(function (h) {
            var item = document.createElement('li');
            item.className = 'page-toc-' + h.tagName.toLowerCase();
            var link = document.createElement('a');
            link.href = '#' + h.id;
            link.textContent = h.textContent.trim();
            item.appendChild(link);
            list.appendChild(item);
            return link;
        });
        aside.appendChild(list);
        wrap.appendChild(aside);

        if (!('IntersectionObserver' in window)) {
            return;
        }

        var visible = new Set();
        function update() {
            var current = null;
            for (var i = 0; i < headings.length; i++) {
                if (visible.has(headings[i])) {
                    current = i;
                    break;
                }
            }
            if (current === null) {
                // Between headings: keep the last heading above the viewport.
                for (var j = headings.length - 1; j >= 0; j--) {
                    if (headings[j].getBoundingClientRect().top < 0) {
                        current = j;
                        break;
                    }
                }
            }
            links.forEach(function (link, k) {
                link.classList.toggle('active', k === current);
                if (k === current) {
                    link.setAttribute('aria-current', 'location');
                } else {
                    link.removeAttribute('aria-current');
                }
            });
        }

        var observer = new IntersectionObserver(
            function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        visible.add(entry.target);
                    } else {
                        visible.delete(entry.target);
                    }
                });
                update();
            },
            { rootMargin: '0px 0px -60% 0px' },
        );
        headings.forEach(function (h) {
            observer.observe(h);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
