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

        // First entry returns to the top of the article (the layout's #top element).
        var introItem = document.createElement('li');
        introItem.className = 'page-toc-intro';
        var intro = document.createElement('a');
        intro.href = '#top';
        intro.textContent = 'Introduction';
        intro.addEventListener('click', function (event) {
            event.preventDefault();
            window.scrollTo(0, 0);
            history.replaceState(null, '', location.pathname + location.search);
        });
        introItem.appendChild(intro);
        list.appendChild(introItem);

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

        // The current section is the last heading that has scrolled into the top 40% of the
        // viewport; before the first one, the introduction is current.
        function update() {
            var threshold = window.innerHeight * 0.4;
            var current = null;
            for (var i = 0; i < headings.length; i++) {
                if (headings[i].getBoundingClientRect().top <= threshold) {
                    current = i;
                } else {
                    break;
                }
            }
            setActive(intro, current === null);
            links.forEach(function (link, k) {
                setActive(link, k === current);
            });
        }

        function setActive(link, active) {
            link.classList.toggle('active', active);
            if (active) {
                link.setAttribute('aria-current', 'location');
            } else {
                link.removeAttribute('aria-current');
            }
        }

        window.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);

        update();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
