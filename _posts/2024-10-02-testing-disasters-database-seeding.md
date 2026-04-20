---
title: "My Experience with Testing Disasters: The Importance of Proper Database Seeding"
date: 2024-10-02 08:00 +0200
categories: [English, Programming, Experience]
tags: [programming, backend-development, experience, tech-talk]
author: amirulislam
---

**The Mistakes We Make in Testing! Lessons from My Experience** 😅

At my first company, we needed a quick way to test OTPs (One-Time Passwords), so guess what? They used my *personal phone number* as the default recipient. Convenient, right?

Well, fast forward to today—I've long since left that company, but my phone keeps receiving OTPs from different banks, like I'm a secret millionaire opening accounts everywhere. 🤦‍♂️ Annoyed, I blacklisted several numbers. Did that help? Not much.

---

### The Next Company's Story 🫣🚨

At my next job, the situation was even wilder. Somebody mistakenly used *production data* in a testing script. In just a few minutes, we had sent test SMS to **3.5 million users**! Yes, you read that right—**millions**!

And as if one mistake wasn't enough, it happened **twice**, in a single day. 😳

Now, imagine if those SMS messages had been promotional offers, cashback promises, or discounts that could cause financial damage to the company. It would have been a full-blown disaster!

**Moral of the story? Please don't make mistakes like this.** You never know how a tiny mistake could cause massive trouble for not just you, but the entire company in a matter of seconds.

---

### Database Seeding: Why It Matters 🌱

So, what's the takeaway? **Proper Database Seeding is crucial**.

For those who aren't familiar, **Database Seeding** means filling your database with initial or test data. It could be:
- Test user data
- Fake locations for check-ins
- Dummy notifications, posts, comments, etc.

**Why Do We Need to Seed the Database?**
- **Consistency in Testing**: With a seeding script, your tests have consistent data every time. Tests become repeatable, predictable, and reliable.
- **Saving Time**: Imagine manually creating new users or comments every single time you run a test. That's a *huge* waste of time. Seeding scripts save you from this boring repetition.
- **Avoid Using Real Data**: Using live, real customer data for testing is dangerous. Accidents—like sending SMS to real users (as I know all too well)—can happen. Dummy data keeps everything safe.

---

### What Type of Data Should You Use for Seeding? 🤔

Simple answer: **Garbage!** Use *absolutely nonsense* for the development database—but make sure it's in the *correct format, type, and size*. For this, you can use libraries like:

- **Faker**: To create fake but realistic-looking data, such as names, emails, and addresses.

For example:
- Fake user: `john.doe@example.com`
- Random transactions with valid-looking amounts and dates

The idea is to make it look real enough so that you can realistically test features, without actually affecting anyone.

---

### Benefits of Seeding ⚙️

- **Realistic Acceptance Testing**: Using realistic data gives you a better idea of how the app will perform in the real world.
- **Privacy Protection**: Using dummy data keeps actual customer information safe.
- **Quick Setup**: Seeding scripts can *automatically* populate your database whenever you set up a new environment.

**Pro Tip**: Never forget to **rollback** test data after testing. Always clean up so it doesn't affect future tests.

---

### Book Recommendation 📚

For more in-depth knowledge, I highly recommend: **"Build APIs You Won't Hate"** by Philip Sturgeon. Every backend developer should read it.

Thanks for reading, and remember: it's always better to use "fake garbage" than to create a real mess! 🗑️😆
