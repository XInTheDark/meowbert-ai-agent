// Story player and the pixel cat. The page works without this file:
// every story step is visible and the cats simply don't appear.

(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Pixel sprites ----------

  const PALETTE = {
    o: "#3b2a2e", // outline
    f: "#f2a65a", // fur
    s: "#d9823b", // stripes
    w: "#fff7ee", // chest and muzzle
    e: "#2b2024", // eyes
    g: "#ffffff", // eye shine
    p: "#f28b9b", // nose and ears
    L: "#8e95a1", // laptop lid
    l: "#c8ccd3", // laptop edge
    G: "#3fa36b", // spreadsheet header
    W: "#ffffff", // spreadsheet paper
    h: "#e8556d", // heart
    r: "#d64545", // alarm mark
  };

  const HEAD = [
    "..o........o....",
    ".ofo......ofo...",
    ".opfo....ofpo...",
    ".offooooooffo...",
    "offffffffffffo..",
    "offfsffffsfffo..",
  ];

  const BODY = [
    ".offwwwwwwffo...",
    ".offfwwwwfffo.o.",
    ".offfwwwwfffoofo",
    ".offffwwffffofo.",
    ".offoffffoffoo..",
    "..oooooooooo....",
  ];

  const face = (eyesTop, eyesBottom, mouth = "fwwwfoofwwwf") => [
    `o${eyesTop}o..`,
    `o${eyesBottom}o..`,
    "ofwfffppfffwfo..",
    `o${mouth}o..`,
  ];

  const SPRITES = {
    sit: [...HEAD, ...face("ffegffffegff", "ffeeffffeeff"), ...BODY],
    blink: [...HEAD, ...face("ffffffffffff", "ffeeffffeeff"), ...BODY],
    happy: [...HEAD, ...face("fffeffffefff", "ffefeffefeff"), ...BODY],
    alert: [
      ...HEAD.slice(0, 5),
      "offegffffegffo..",
      ...face("ffeeffffeeff", "ffeeffffeeff", "fwwwfppfwwwf"),
      ...BODY,
    ],
    typeA: [
      ...HEAD,
      ...face("ffffffffffff", "ffegffffegff"),
      ".offwwwwwwffo...",
      "lLLwwLLLLLLLLl..",
      "lLLLLLlLLLLLLl..",
      "lLLLLLLLLLLLLl..",
      "llllllllllllll..",
      "................",
    ],
    typeB: [
      ...HEAD,
      ...face("ffffffffffff", "ffegffffegff"),
      ".offwwwwwwffo...",
      "lLLLLLLLLwwLLl..",
      "lLLLLLlLLLLLLl..",
      "lLLLLLLLLLLLLl..",
      "llllllllllllll..",
      "................",
    ],
    carry: [
      ...HEAD,
      "offfeffffefffo..",
      "offefeffefeffo..",
      "ofwfffppfffwfo..",
      "ofwwGGGGGGwwfo..",
      ".offWGWWGWffo...",
      ".offWWWWWWffo.o.",
      ".offWGWWGWffoofo",
      ".offffwwffffofo.",
      ".offoffffoffoo..",
      "..oooooooooo....",
    ],
    sleep: [
      "..o..o..............",
      ".ofoofo.............",
      ".offffoooooooo......",
      "offffffffsfsffoo....",
      "ofeefffffffsfsfffo..",
      "offffpffffffffffffo.",
      "owwwwffffffffffffffo",
      "owwwsssssssssssssffo",
      ".ooooooooooooooooooo",
    ],
    heart: [".hh.hh.", "hhhhhhh", "hhhhhhh", ".hhhhh.", "..hhh..", "...h..."],
    bang: ["rr", "rr", "rr", "rr", "..", "rr"],
  };

  function drawSprite(rows, scale) {
    const height = rows.length;
    const width = Math.max(...rows.map((row) => row.length));
    let rects = "";
    rows.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        const color = PALETTE[cell];
        if (color) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`;
      });
    });
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
      `width="${width * scale}" height="${height * scale}" shape-rendering="crispEdges" aria-hidden="true">` +
      `${rects}</svg>`
    );
  }

  function makeCatButton(label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cat";
    button.setAttribute("aria-label", label);
    return button;
  }

  function releaseHearts(host) {
    for (let i = 0; i < 3; i += 1) {
      const heart = document.createElement("span");
      heart.className = "heart";
      heart.innerHTML = drawSprite(SPRITES.heart, 3);
      heart.style.left = `${18 + i * 10}px`;
      heart.style.top = `${-4 - i * 6}px`;
      heart.style.setProperty("--dx", `${(i - 1) * 14}px`);
      heart.style.animationDelay = `${i * 120}ms`;
      host.appendChild(heart);
      setTimeout(() => heart.remove(), 1500 + i * 120);
    }
  }

  // ---------- Story cat ----------

  function createStoryCat(perch) {
    const button = makeCatButton("Pet the cat");
    perch.appendChild(button);

    let mood = "sit";
    let override = null;
    let typingFrame = false;
    let blinking = false;

    const render = () => {
      let sprite = override || mood;
      if (sprite === "sit" && blinking) sprite = "blink";
      if (sprite === "type") sprite = typingFrame ? "typeA" : "typeB";
      button.innerHTML = drawSprite(SPRITES[sprite], 4);
      perch.querySelector(".cat-bang")?.remove();
      if (sprite === "alert") {
        const bang = document.createElement("span");
        bang.className = "cat-bang";
        bang.innerHTML = drawSprite(SPRITES.bang, 4);
        perch.appendChild(bang);
      }
    };

    if (!reduceMotion) {
      setInterval(() => {
        if (mood !== "type" || override) return;
        typingFrame = !typingFrame;
        render();
      }, 220);
      setInterval(() => {
        if (mood !== "sit" || override) return;
        blinking = true;
        render();
        setTimeout(() => {
          blinking = false;
          render();
        }, 160);
      }, 3400);
    }

    let pettingTimer;
    button.addEventListener("click", () => {
      override = "happy";
      render();
      releaseHearts(perch);
      clearTimeout(pettingTimer);
      pettingTimer = setTimeout(() => {
        override = null;
        render();
      }, 1300);
    });

    render();

    return (nextMood) => {
      if (nextMood === mood) return;
      mood = nextMood;
      perch.classList.remove("is-alert");
      if (mood === "alert" && !reduceMotion) {
        void perch.offsetWidth;
        perch.classList.add("is-alert");
      }
      render();
    };
  }

  // ---------- Footer cat ----------

  function createFooterCat(bed) {
    const button = makeCatButton("Wake the cat");
    bed.appendChild(button);
    const zzz = document.createElement("span");
    zzz.className = "zzz";
    zzz.textContent = "z z";
    bed.appendChild(zzz);

    let sleepTimer;
    const sleep = () => {
      button.innerHTML = drawSprite(SPRITES.sleep, 4);
      zzz.hidden = false;
    };
    const wake = () => {
      button.innerHTML = drawSprite(SPRITES.happy, 2.5);
      zzz.hidden = true;
      clearTimeout(sleepTimer);
      sleepTimer = setTimeout(sleep, 2600);
    };

    button.addEventListener("click", () => {
      wake();
      releaseHearts(bed);
    });
    button.addEventListener("mouseenter", wake);
    sleep();
  }

  // ---------- Story player ----------

  function createPlayer(player) {
    const controls = player.querySelector("[data-controls]");
    const columns = player.querySelector(".columns");
    const beats = [...player.querySelectorAll("[data-step]")];
    const stepButtons = [...player.querySelectorAll("[data-goto]")];
    const prev = player.querySelector("[data-prev]");
    const next = player.querySelector("[data-next]");
    const last = stepButtons.length;
    const stepMs = 4200;
    const perch = player.querySelector('[data-cat="story"]');
    const setCatMood = perch ? createStoryCat(perch) : () => {};
    const moods = { 1: "sit", 2: "type", 3: "alert", 4: "carry" };

    let current = 1;
    let timer = null;

    const show = (step) => {
      current = Math.min(Math.max(step, 1), last);
      columns.dataset.current = String(current);
      beats.forEach((beat) => {
        const beatStep = Number(beat.dataset.step);
        beat.classList.toggle("is-future", beatStep > current);
        beat.classList.toggle("is-current", beatStep === current);
      });
      stepButtons.forEach((button) => {
        const buttonStep = Number(button.dataset.goto);
        button.classList.toggle("is-past", buttonStep < current);
        button.classList.toggle("is-playing", Boolean(timer) && buttonStep === current);
        if (buttonStep === current) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
      prev.disabled = current === 1;
      next.disabled = current === last;
      setCatMood(moods[current]);
    };

    const stop = () => {
      clearInterval(timer);
      timer = null;
      show(current);
    };

    const play = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (current >= last) {
          stop();
          return;
        }
        show(current + 1);
        if (current >= last) stop();
      }, stepMs);
      show(current);
    };

    controls.hidden = false;
    player.style.setProperty("--step-ms", `${stepMs}ms`);

    stepButtons.forEach((button) =>
      button.addEventListener("click", () => {
        stop();
        show(Number(button.dataset.goto));
      }),
    );
    prev.addEventListener("click", () => {
      stop();
      show(current - 1);
    });
    next.addEventListener("click", () => {
      stop();
      show(current + 1);
    });
    player.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      stop();
      show(current + (event.key === "ArrowRight" ? 1 : -1));
    });

    show(1);

    if (!reduceMotion && "IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          play();
        },
        { threshold: 0.35 },
      );
      observer.observe(columns);
    }
  }

  // ---------- Click to enlarge ----------

  function setupZoom() {
    const images = document.querySelectorAll(".examples img, .pair img");
    if (!images.length || typeof HTMLDialogElement !== "function") return;

    const dialog = document.createElement("dialog");
    dialog.className = "zoom";
    dialog.setAttribute("aria-label", "Enlarged image");
    const large = document.createElement("img");
    large.alt = "";
    dialog.appendChild(large);
    document.body.appendChild(dialog);
    dialog.addEventListener("click", () => dialog.close());

    images.forEach((image) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "zoomable";
      button.setAttribute("aria-label", `Enlarge: ${image.alt}`);
      image.replaceWith(button);
      button.appendChild(image);
      button.addEventListener("click", () => {
        large.src = image.currentSrc || image.src;
        large.alt = image.alt;
        dialog.showModal();
      });
    });
  }

  document.querySelectorAll("[data-player]").forEach(createPlayer);
  document.querySelectorAll('[data-cat="footer"]').forEach(createFooterCat);
  setupZoom();
})();
