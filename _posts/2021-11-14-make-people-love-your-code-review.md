---
title: "Make People Love Your Code Review"
date: 2021-11-14 05:50 +0600
categories: [English, Programming]
tags: [programming, tech-talk, backend-development]
author: amirulislam
---

**Code review is painful. Fixing the code according to the reviewer's comment is more painful. Let's make the process easier.** 🤗

**Code review** means viewing, reading, or checking (sometimes changing) others' code, and providing effective feedback so that the codebase can be improved and optimized—and also to find bugs. It's an effective approach for **Software Quality Assurance (SQA)**.

There are lots of benefits to code review. It's really useful for both sides. While reviewing someone else's code, you can get ideas about their coding style. It increases understanding in both the programmer and the reviewer. It also helps find critical mistakes, exceptions, errors, and serious bugs. Most importantly, collaborating and sharing new ideas and techniques can make your code much better and more efficient.

---

### Best Practices of Code Review

We will not describe how to review code in this post. We will discuss some good practices.

- First, know **which part** of the project you want/need to review. It can be structure, style, performance, logic, design, test coverage, readability, or functionality. But first of all, make sure you actually understand the codebase.
- Before starting a code review, **build the code in your local environment**, run it, and test it. If all test cases pass, the code is stable and ready to review.
- **Fresh eyes are important**. Don't continue code reviewing for more than **60 minutes** at a time. Take a break, let your brain reset. It's said that not more than **400 lines of code** should be checked at a time.
- Finally, **feedback should be constructive**. Feedback shouldn't be written in a way that might hurt the coder. Rather than providing a statement, ask: "How would it be if we did this instead?" Always be nice in commenting. Sometimes giving praise alongside your constructive feedback works better than you'd think! For example: *"Good idea indeed! I didn't even know that was possible."*

---

### Address the Code, Not the Person

Always remember: your concern is the **lines of code**, not the human behind them. Don't comment in a way that addresses a person rather than the exact issue itself.

For example, in a division operation:

❌ *"You didn't check for divisor 0."*

✔️ *"Input value of divisor could be zero (0), causing `ArithmeticException`. A client error should be thrown."*

In the second comment, you will see that it includes:
1. The **problem statement**
2. The **problem's impact**
3. The **solution**

This helps the coder understand the problem accurately and fix the issue quickly.

---

Code reviews done right can transform team culture. They become a place to learn, share, and grow—not a battlefield. What's your experience with code reviews? Share below! 🙌
