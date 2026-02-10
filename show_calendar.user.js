// ==UserScript==
// @name         MyPlan Calendar
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Add a calendar view to MyPlan
// @author       Hangyu Feng
// @match        https://myplan.uw.edu/plan/*
// @grant        none
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/hangyu-feng/myplan_calendar
// @supportURL   https://github.com/hangyu-feng/myplan_calendar/issues
// @updateURL    https://github.com/hangyu-feng/myplan_calendar/raw/main/show_calendar.user.js
// @downloadURL  https://github.com/hangyu-feng/myplan_calendar/raw/main/show_calendar.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const CALENDAR_ID = 'myplan-calendar-modal';
    const BUTTON_ID = 'myplan-calendar-btn';

    // Utility to parse time string "10:30 - 11:20" to minutes from midnight
    function parseTime(timeStr) {
        let parts = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (!parts) return null;

        let hours = parseInt(parts[1], 10);
        let minutes = parseInt(parts[2], 10);
        let meridiem = parts[3] ? parts[3].toUpperCase() : null;

        return { hours, minutes, meridiem };
    }

    function convertToMinutes(timeObj, isEnd = false) {
        let { hours, minutes, meridiem } = timeObj;

        if (meridiem === 'PM' && hours !== 12) hours += 12;
        if (meridiem === 'AM' && hours === 12) hours = 0;

        if (!meridiem) {
             if (hours < 8) hours += 12;
        }

        return hours * 60 + minutes;
    }

    function findCourses() {
        const courses = [];
        const items = document.querySelectorAll('li[id^="plan-item-"]');
        
        items.forEach(item => {
            // Title extraction
            let code = "Unknown";
            let courseName = "";
            let deptName = "";
            
            const codeLink = item.querySelector('h3 a');
            if (codeLink) {
                code = codeLink.textContent.trim();
                const ariaLabel = (codeLink.getAttribute('aria-label') || "").trim().replace(/\s+/g, ' ');
                
                const match = ariaLabel.match(/^(.*?)\s+(\d{3})\s+(.*)$/);
                if (match) {
                    deptName = match[1].trim();
                    courseName = match[3].trim();
                }

                if (!courseName || courseName.length < 3) {
                    const allLinks = Array.from(item.querySelectorAll('a'));
                    const nameLink = allLinks.find(a => a !== codeLink && !a.href.includes('sln.asp') && !a.textContent.includes('Check enrollment'));
                    if (nameLink) {
                        courseName = nameLink.textContent.trim();
                    }
                }
            }

            const title = courseName ? `${code} ${courseName}` : code;

            // Robust Detail Extraction
            const sectionEl = item.querySelector('.code.primary');
            const section = sectionEl ? sectionEl.innerText.trim() : "";

            const instrEl = item.querySelector('.section-instructor');
            const instructor = instrEl ? instrEl.innerText.replace('Instructor:', '').trim().replace(/\n/g, ', ') : "";

            // Precise Format Extraction
            const formatEl = Array.from(item.querySelectorAll('span')).find(el => {
                const t = el.innerText.trim();
                return t === 'In-person' || t === 'Online' || t === 'Hybrid';
            });
            const learningFormat = formatEl ? formatEl.innerText.trim() : "";

            // Precise Availability Extraction
            let availability = "";
            const badges = Array.from(item.querySelectorAll('.badge'));
            const statusBadge = badges.find(b => b.innerText.includes('SECTION IS'));
            const status = statusBadge ? statusBadge.innerText.replace('SECTION IS', '').trim() : "";
            
            const seatsBadge = badges.find(b => b.innerText.includes('SEATS'));
            if (seatsBadge) {
                const text = seatsBadge.innerText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                const match = text.match(/(\d+)\s+.*?(\d+)/);
                if (match) {
                    availability = `${status} (${match[1]}/${match[2]} available)`;
                } else {
                    availability = status ? `${status} (${text})` : text;
                }
            } else {
                availability = status;
            }

            // Precise Location Extraction
            let location = "";
            const locAnchor = Array.from(item.querySelectorAll('span')).find(el => el.innerText.includes('building room'));
            if (locAnchor) {
                location = locAnchor.parentElement.innerText.replace('building room', '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
            }

            const slnEl = Array.from(item.querySelectorAll('a')).find(a => a.href.includes('sln.asp') && /^\d{5}$/.test(a.innerText.trim()));
            const sln = slnEl ? slnEl.innerText.trim() : "";

            // Precise Credit Extraction
            let credits = "";
            const creditBadge = Array.from(item.querySelectorAll('.badge')).find(el => el.innerText.includes('CR') || el.innerText.includes('Credit'));
            if (creditBadge) credits = creditBadge.innerText.replace(/\n/g, ' ').trim();

            const restLinkEl = Array.from(item.querySelectorAll('a')).find(a => a.innerText.includes('Check enrollment restrictions'));
            const restrictionsLink = restLinkEl ? restLinkEl.href : (slnEl ? slnEl.href : "");

            // Days and Times extraction
            const daySpan = item.querySelector('span[title*="day"], span[title*="Monday"], span[title*="Tuesday"]');
            const times = item.querySelectorAll('time');

            if (daySpan && times.length >= 2) {
                const dayStr = daySpan.textContent.trim();
                const startTimeStr = times[0].getAttribute('datetime');
                const endTimeStr = times[1].getAttribute('datetime');

                if (startTimeStr && endTimeStr) {
                    const startMin = parse24hToMinutes(startTimeStr);
                    const endMin = parse24hToMinutes(endTimeStr);

                    const days = [];
                    let d = dayStr;
                    if (d.includes("Th")) {
                        days.push("Th");
                        d = d.replace("Th", "");
                    }
                    for (let char of d) {
                        if (['M','T','W','F'].includes(char)) days.push(char);
                    }

                    const colors = getCourseColor(code);
                    courses.push({
                        code, deptName, courseName, title, section, instructor, location, sln, restrictionsLink,
                        learningFormat, availability, credits,
                        days, start: startMin, end: endMin, bg: colors.bg, text: colors.text
                    });
                }
            }
        });
        
        return courses;
    }

    function parse24hToMinutes(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    }

    const UW_PALETTE = [
        { bg: '#39275B', text: '#ffffff' }, // Primary Purple
        { bg: '#C79900', text: '#000000' }, // Secondary Gold
        { bg: '#E3BF42', text: '#000000' }, // Background Gold
        { bg: '#DFDDE8', text: '#000000' }, // Background Light Purple
        { bg: '#5B8F22', text: '#ffffff' }, // Accent Bright Green
        { bg: '#0046AD', text: '#ffffff' }, // Accent Bright Blue
        { bg: '#C75B12', text: '#ffffff' }, // Accent Bright Orange
        { bg: '#165788', text: '#ffffff' }, // Muted Dark Blue
        { bg: '#BD4F19', text: '#ffffff' }, // Muted Burnt Orange
        { bg: '#4b2e83', text: '#ffffff' }, // Spirit Purple
        { bg: '#898F4B', text: '#000000' }, // Muted Olive
        { bg: '#93B1CC', text: '#000000' }  // Muted Blue
    ];

    function getCourseColor(title) {
        let hash = 0;
        for (let i = 0; i < title.length; i++) {
            hash = title.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % UW_PALETTE.length;
        return UW_PALETTE[index];
    }

    function renderCalendar(courses) {
        let modal = document.getElementById(CALENDAR_ID);
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = CALENDAR_ID;
        Object.assign(modal.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0,0,0,0.8)',
            zIndex: '10000',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            fontFamily: '"Open Sans", sans-serif'
        });

        const content = document.createElement('div');
        Object.assign(content.style, {
            backgroundColor: '#fff',
            width: '95%',
            height: '95%',
            borderRadius: '8px',
            padding: '10px',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column'
        });

        // Side Popover element (Google Calendar style)
        const popover = document.createElement('div');
        Object.assign(popover.style, {
            position: 'fixed',
            display: 'none',
            backgroundColor: '#39275B', // UW Purple
            color: 'white',
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
            zIndex: '10001',
            width: '320px',
            lineHeight: '1.4',
            border: '2px solid #C79900', // UW Gold border
            pointerEvents: 'auto'
        });
        document.body.appendChild(popover);

        const closeCalendar = (e) => {
            if (e && e.type === 'keydown' && e.key !== 'Escape') return;
            modal.remove();
            popover.remove();
            window.removeEventListener('keydown', closeCalendar);
        };
        window.addEventListener('keydown', closeCalendar);

        // Close entire calendar if clicking the backdrop (the modal div itself)
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeCalendar();
            } else {
                popover.style.display = 'none';
            }
        });

        // Prevent clicks inside the popover from closing itself
        popover.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
            padding: '0 5px'
        });

        const calendarTitle = document.createElement('h2');
        calendarTitle.textContent = 'Planned Courses Calendar';
        calendarTitle.style.margin = '0';
        calendarTitle.style.color = '#39275B';
        header.appendChild(calendarTitle);

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times; Close';
        closeBtn.onclick = closeCalendar;

        Object.assign(closeBtn.style, {
            padding: '8px 16px',
            cursor: 'pointer',
            backgroundColor: '#39275B', // UW Purple
            color: 'white',
            border: '1px solid #C79900', // UW Gold
            borderRadius: '4px',
            fontWeight: 'bold',
            fontSize: '14px',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        });

        closeBtn.onmouseenter = () => {
            closeBtn.style.backgroundColor = '#C79900'; // UW Gold
            closeBtn.style.color = '#000000'; // Black
        };
        closeBtn.onmouseleave = () => {
            closeBtn.style.backgroundColor = '#39275B'; // UW Purple
            closeBtn.style.color = 'white';
        };
        header.appendChild(closeBtn);
        content.appendChild(header);

        // Calendar Grid
        const gridWrapper = document.createElement('div');
        Object.assign(gridWrapper.style, {
            flex: '1',
            overflowY: 'auto',
            position: 'relative',
            border: '1px solid #ccc'
        });

        const grid = document.createElement('div');
        Object.assign(grid.style, {
            display: 'flex',
            minHeight: '100%'
        });

        // Define time range
        const startHour = 7; // 7 AM
        const endHour = 22; // 10 PM
        const hourHeight = 80; // px

        // Time Column
        const timeCol = document.createElement('div');
        timeCol.style.width = '60px';
        timeCol.style.flexShrink = '0';
        timeCol.style.backgroundColor = '#f9f9f9';
        timeCol.style.borderRight = '1px solid #ccc';

        // Spacer for header
        const timeHeaderSpacer = document.createElement('div');
        timeHeaderSpacer.style.height = '30px';
        timeHeaderSpacer.style.borderBottom = '1px solid #ccc';
        timeCol.appendChild(timeHeaderSpacer);

        for (let h = startHour; h < endHour; h++) {
            const cell = document.createElement('div');
            cell.textContent = `${h > 12 ? h - 12 : h} ${h >= 12 ? 'PM' : 'AM'}`;
            Object.assign(cell.style, {
                height: `${hourHeight}px`,
                borderBottom: '1px solid #eee',
                textAlign: 'right',
                paddingRight: '5px',
                fontSize: '12px',
                color: '#666'
            });
            timeCol.appendChild(cell);
        }
        grid.appendChild(timeCol);

        // Prepare Day Events
        const dayMap = { 'M': 0, 'T': 1, 'W': 2, 'Th': 3, 'F': 4 };
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        const dayEvents = [[], [], [], [], []];

        courses.forEach(course => {
            course.days.forEach(day => {
                const dayIdx = dayMap[day];
                if (dayIdx !== undefined) {
                    dayEvents[dayIdx].push({ ...course });
                }
            });
        });

        // Day Columns
        dayNames.forEach((dayName, dayIdx) => {
            const col = document.createElement('div');
            Object.assign(col.style, {
                flex: '1',
                position: 'relative',
                borderRight: '1px solid #ccc',
                minWidth: '100px'
            });

            // Header
            const header = document.createElement('div');
            header.textContent = dayName;
            Object.assign(header.style, {
                height: '30px',
                borderBottom: '1px solid #ccc',
                textAlign: 'center',
                fontWeight: 'bold',
                backgroundColor: '#f0f0f0',
                lineHeight: '30px',
                position: 'sticky',
                top: '0',
                zIndex: '10'
            });
            col.appendChild(header);

            // Content Container
            const contentContainer = document.createElement('div');
            contentContainer.style.position = 'relative';
            contentContainer.style.height = `${(endHour - startHour) * hourHeight}px`;

            // Grid lines
            for (let h = startHour; h < endHour; h++) {
                const line = document.createElement('div');
                line.style.height = `${hourHeight}px`;
                line.style.borderBottom = '1px solid #eee';
                line.style.boxSizing = 'border-box';
                contentContainer.appendChild(line);
            }

            // Layout Algorithm: Side-by-Side
            const events = dayEvents[dayIdx].sort((a, b) => a.start - b.start);
            const columns = [];
            events.forEach(ev => {
                let placed = false;
                for (let i = 0; i < columns.length; i++) {
                    if (columns[i] <= ev.start) {
                        ev.col = i;
                        columns[i] = ev.end;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    ev.col = columns.length;
                    columns.push(ev.end);
                }
            });

            const clusters = [];
            let currentCluster = [];
            let clusterMaxEnd = -1;

            events.forEach(ev => {
                if (currentCluster.length === 0) {
                    currentCluster.push(ev);
                    clusterMaxEnd = ev.end;
                } else {
                    if (ev.start < clusterMaxEnd) {
                        currentCluster.push(ev);
                        clusterMaxEnd = Math.max(clusterMaxEnd, ev.end);
                    } else {
                        clusters.push(currentCluster);
                        currentCluster = [ev];
                        clusterMaxEnd = ev.end;
                    }
                }
            });
            if (currentCluster.length > 0) clusters.push(currentCluster);

            // Render Events
            clusters.forEach(cluster => {
                let maxCol = 0;
                cluster.forEach(ev => maxCol = Math.max(maxCol, ev.col));
                const widthPercent = 100 / (maxCol + 1);

                cluster.forEach(ev => {
                    const top = ((ev.start / 60) - startHour) * hourHeight + (ev.start % 60) * (hourHeight/60);
                    const height = (ev.end - ev.start) * (hourHeight/60);

                    const eventEl = document.createElement('div');
                    const startH = Math.floor(ev.start / 60);
                    const startM = ev.start % 60;
                    const endH = Math.floor(ev.end / 60);
                    const endM = ev.end % 60;
                    const timeText = `${startH > 12 ? startH-12 : startH}:${startM.toString().padStart(2,'0')} - ${endH > 12 ? endH-12 : endH}:${endM.toString().padStart(2,'0')}`;

                    eventEl.innerHTML = `
                        <div style="font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${ev.code}</div>
                        <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:0.95em; opacity:0.9;">${ev.courseName}</div>
                        <div style="font-size:0.85em; opacity:0.85; margin-top:1px;">${timeText}</div>
                    `;

                    Object.assign(eventEl.style, {
                        position: 'absolute',
                        top: `${top}px`,
                        left: `${ev.col * widthPercent}%`,
                        width: `${widthPercent}%`,
                        height: `${height}px`,
                        backgroundColor: ev.bg,
                        color: ev.text,
                        borderRadius: '4px',
                        padding: '2px 4px',
                        fontSize: '11px',
                        lineHeight: '1.2',
                        overflow: 'hidden',
                        opacity: '0.95',
                        zIndex: '5',
                        border: '1px solid white',
                        boxSizing: 'border-box',
                        cursor: 'pointer',
                        transition: 'transform 0.1s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: height < 40 ? 'center' : 'start'
                    });

                    eventEl.onmouseenter = () => {
                        eventEl.style.transform = 'scale(1.02)';
                        eventEl.style.zIndex = '100';
                    };
                    eventEl.onmouseleave = () => {
                        eventEl.style.transform = 'scale(1)';
                        eventEl.style.zIndex = '5';
                    };

                    eventEl.onclick = (e) => {
                        e.stopPropagation();
                        
                        let content = `<div style="color:#C79900; font-weight:800; font-size:1.25em; margin-bottom:2px;">${ev.code}</div>`;
                        content += `<div style="font-weight:700; font-size:1.1em; margin-bottom:4px; line-height:1.2;">${ev.courseName}</div>`;
                        
                        if (ev.deptName) {
                            content += `<div style="font-size:0.85em; opacity:0.8; margin-bottom:12px; font-style:italic; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">${ev.deptName}</div>`;
                        }

                        content += `<div style="display:grid; grid-template-columns: auto 1fr; gap: 8px 12px; font-size:0.95em; align-items: start;">`;
                        if (ev.sln) content += `<span style="opacity:0.7; font-size:0.9em; text-transform:uppercase; letter-spacing:0.05em;">SLN:</span><span style="font-family:monospace; font-weight:bold;">${ev.sln}</span>`;
                        if (ev.section) content += `<span style="opacity:0.7; font-size:0.9em; text-transform:uppercase; letter-spacing:0.05em;">Section:</span><span>${ev.section}</span>`;
                        if (ev.credits) content += `<span style="opacity:0.7; font-size:0.9em; text-transform:uppercase; letter-spacing:0.05em;">Credits:</span><span>${ev.credits}</span>`;
                        if (ev.learningFormat) content += `<span style="opacity:0.7; font-size:0.9em; text-transform:uppercase; letter-spacing:0.05em;">Format:</span><span>${ev.learningFormat}</span>`;
                        if (ev.instructor) content += `<span style="opacity:0.7; font-size:0.9em; text-transform:uppercase; letter-spacing:0.05em;">Instructor:</span><span>${ev.instructor}</span>`;
                        if (ev.location) content += `<span style="opacity:0.7; font-size:0.9em; text-transform:uppercase; letter-spacing:0.05em;">Location:</span><span>${ev.location}</span>`;
                        if (ev.availability) content += `<span style="opacity:0.7; font-size:0.9em; text-transform:uppercase; letter-spacing:0.05em;">Availability:</span><span>${ev.availability}</span>`;
                        content += `</div>`;

                        content += `<div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.2); padding-top:10px; display:flex; flex-direction:column; gap:8px;">`;
                        content += `<div style="font-weight:bold; font-size:1.0em; color:#C79900;">🕒 ${timeText}</div>`;
                        
                        if (ev.restrictionsLink) {
                            content += `<div style="font-size:0.9em;"><a href="${ev.restrictionsLink}" target="_blank" style="color:#C79900; text-decoration:underline; font-weight:600;">Check Enrollment Restrictions</a></div>`;
                        }
                        content += `</div>`;
                        
                        popover.innerHTML = content;
                        popover.style.display = 'block';

                        const rect = eventEl.getBoundingClientRect();
                        let left = rect.right + 10;
                        let top = rect.top;

                        if (left + 320 > window.innerWidth) {
                            left = rect.left - 330;
                        }
                        
                        if (top + popover.offsetHeight > window.innerHeight) {
                            top = window.innerHeight - popover.offsetHeight - 20;
                        }

                        popover.style.left = `${left}px`;
                        popover.style.top = `${top}px`;
                    };

                    contentContainer.appendChild(eventEl);
                });
            });

            col.appendChild(contentContainer);
            grid.appendChild(col);
        });

        gridWrapper.appendChild(grid);
        content.appendChild(gridWrapper);
        modal.appendChild(content);
        document.body.appendChild(modal);
    }

    function addTriggerButton() {
        const isPlanPage = /^#\/[a-z]{2}\d{2}/i.test(window.location.hash);
        const existingBtn = document.getElementById(BUTTON_ID);

        if (!isPlanPage) {
            if (existingBtn) existingBtn.remove();
            return;
        }

        if (existingBtn) return;

        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.textContent = '📅 View Calendar';
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: '9999',
            padding: '10px 20px',
            backgroundColor: '#4b2e83', // UW Purple
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
            fontSize: '16px'
        });

        btn.onclick = () => {
            const courses = findCourses();
            if (courses.length === 0) {
                alert("No courses found! Make sure you are on the 'Planned' or 'Schedule' page and course times are visible.");
            } else {
                renderCalendar(courses);
            }
        };

        document.body.appendChild(btn);
    }

    window.addEventListener('load', addTriggerButton);
    window.addEventListener('hashchange', addTriggerButton);
    setInterval(addTriggerButton, 2000);

})();