---
title: "কোড রিভিউ কেন করবেন, কিভাবে করবেন (প্রথম পর্ব)"
date: 2021-10-22 12:00 +0600
categories: [বাংলা]
tags: [programming, tech-talk, backend-development]
author: amirulislam
---

অন্যের personal life নিয়ে নাক গলানো হয়তো ঠিক না। কিন্তু অন্যের কোডে নাক গলানো কি ঠিক হবে? জ্বী, অবশ্যই ঠিক হবে। And come on — it's a good practice and it's called **code review**! 🤗

---

### কোড রিভিউ কী?

সহজ ভাষায় **code review** মানে হল একজন অন্যজনের কোড চেক করা, চেঞ্জ করা কিংবা effective feedback দেওয়া যাতে codebase আরো improve করা যায়, optimize করা যায় এবং bug বের করা যায়। Software quality নিশ্চিত করার জন্য এটা খুবই effective একটা practice।

আমি বলব, সময় পেলেই আপনার বন্ধুর কিংবা colleagues-দের কোড review করবেন। এর মাধ্যমে নিজেও শিখবেন। যদি আপনাদের মধ্যে সেরকম সম্পর্ক না থাকে বা open source project না হয়ে থাকে তাহলে অবশ্যই আগে অনুমতি নিয়ে নিবেন।

GitHub-এ অনেক open source project আছে, সেখানে review করতে পারেন বা আপনার কোড review চাইতে পারেন।

---

### কোড রিভিউর উপকারিতা

- অন্যের coding style সম্পর্কে আইডিয়া পাওয়া যায়
- পরস্পরের মধ্যে understanding বাড়ে
- Critical mistakes, errors এবং serious bugs ধরা পড়ে
- নতুন ideas এবং techniques share করা যায় যা কোডকে আরো better এবং efficient করে

---

### গুরুত্বপূর্ণ কিছু Best Practices

**১. কোন পার্টটা review করবেন জানুন**

প্রথমে জানতে হবে project-এর বা কোডের কোন অংশটা review করতে চাই বা করা প্রয়োজন। যেমন হতে পারে — structure, style, logic, performance, design, test coverage, readability কিংবা functionality।

কিন্তু সবার প্রথমে যেটা দরকার সেটা হল কোডটা আসলে কি কাজ করছে সেটা আমি বুঝেছি কিনা।

**২. আগে নিজে run করুন**

Code review করার আগে কোডটা নিজের environment-এ build করে, run করে, test করে দেখুন। যদি সবগুলো test case pass করে তাহলে কোডটা stable এবং review-এর জন্য প্রস্তুত।

**৩. Fresh চোখের দরকার**

Code review করার জন্য fresh চোখের দরকার। তাই, টানা **৬০ মিনিটের বেশি code review কখনোই নয়**। নির্দিষ্ট সময় অন্তর break নিন এবং আপনার brain-কে reset হওয়ার সময় দিন।

বলা হয়ে থাকে, একসাথে **৪০০ লাইনের বেশি কোড চেক করা উচিত নয়**।

**৪. Constructive feedback দিন**

অবশ্যই **constructive feedback** দিতে হবে। এমনভাবে feedback লেখা যাবে না যেটা তাকে hurt করে। Statement দেওয়ার বদলে প্রশ্ন আকারে বলতে পারেন — *"এমন করলে কেমন হয়?"*

আর যেখানে ভালো কিছু করা হয়েছে, সেখানে praise-ও দিন! Constructive feedback-এর পাশাপাশি praise অনেক বেশি কার্যকর।

---

code review automate করে সময় সেভ করা থেকে শুরু করে কোড review কিভাবে কোথায় করব সে বিষয়ে বিস্তারিত পরবর্তী পর্বে লেখার চেষ্টা করব।

কোনো প্রশ্ন থাকলে comment করতে পারেন! 🙌
