---
title: "Speed Up Your Python Code"
date: 2021-11-04 08:43 +0600
categories: [English, Programming]
tags: [programming, python, tech-talk, optimization]
author: amirulislam
---

**Python is awesome, but it can be slow. Let's make Python code run incredibly faster.** 😉

Python is one of the most popular programming languages among developers. It is easy to use, powerful, and versatile. However, when it comes to working with large quantities of data, Python can be really slow. Here are tips to speed it up:

---

### 1. Use Proper Algorithms and Data Structures

Each data structure has a significant effect on runtime. Python has many built-in data structures such as list, tuple, set, and dictionary.

If you don't have duplicate items in the collection, need to search items repeatedly, and the collection contains a large number of items, then using **sets** and **dictionaries** is the wise decision. Sets and dictionaries use hash tables, so the time complexity of each lookup is only **O(1)**.

---

### 2. Use Built-in Functions and Libraries

Never write your own function if it already exists in the library. Library functions are well-tested and highly optimized. Python's built-in functions are implemented in C. Some popular built-in functions: `min`, `max`, `avg`, `all`, `map`, etc.

```python
from math import sqrt

mylist = [5, 3, 45, 49]
newlist = map(sqrt, mylist)
```

---

### 3. Use While Loop Instead of For Loop

`for` loops are dynamic in Python, so they take more time than `while` loops. Prefer `while` when performance matters.

---

### 4. Use Multiple Assignment

```python
# Instead of:
first = 1
second = 2
third = 3
fourth = 4

# Use:
first, second, third, fourth = 1, 2, 3, 4
```

---

### 5. Use Local Variables Instead of Global Variables

Global variables take higher time during operation than local variables. Always prefer local scope when possible.

---

### 6. Use List Comprehension

```python
# Instead of:
mylist = []
for i in range(1, 21):
    for j in range(1, 21):
        if i % 3 == 0 and j % 5 == 0:
            mylist.append((i, j))

# Use:
mylist = [(i, j) for i in range(1, 21) for j in range(1, 21)
          if i % 3 == 0 and j % 5 == 0]
```

---

### 7. Use Join Method to Concatenate Strings

```python
# Instead of:
newstring = "coding" + " " + "is" + " " + "fun"

# Use:
newstring = " ".join(["coding", "is", "fun"])
```

---

### 8. Use Proper Imports, Avoid Dot Operations

```python
# Instead of:
import math
value = math.sqrt(266)

# Use:
from math import sqrt
value = sqrt(266)
```

---

### 9. Change Coding Style: Early Returns

```python
# Instead of:
if condition_a:
    if condition_b:
        if condition_c:
            do_something
            return True
        else:
            return False
    else:
        return False
else:
    return False

# Use:
if (not condition_a) or (not condition_b) or (not condition_c):
    return False
do_something
return True
```

---

### 10. Avoid Unnecessary Function Calls Inside Loops

Function calls are expensive in Python. Be cautious about calling functions from inside a loop.

```python
# Instead of:
def get_square(num):
    return num ** 2

mysquares = []
for i in range(100000):
    mysquares.append(get_square(i))

# Use:
mysquares = []
for i in range(100000):
    mysquares.append(i**2)
```

---

### 11. Use Special Libraries for Large Datasets

Many Python packages have been written in C/C++. The most popular are **NumPy**, **SciPy**, and **Pandas**. Try to use them to process large datasets.

---

### 12. Use the Latest Release of Python

Python is updated regularly. In every release it becomes more stable, faster, and more optimized. Always try to use the latest version.

---

### Conclusion

There are also a few advanced techniques: using **PyPy**, **Cython**, threads, `asyncio`, and multiprocessing. Use threading and `asyncio` for I/O-bound software, and multiprocessing for CPU-bound problems. For even more advanced scaling, you can leverage cloud computing platforms like Hadoop.

Happy Programming! 🚀
