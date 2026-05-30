const express = require('express')
const router = express.Router()
const db = require('../db')

// All categories
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM categories ORDER BY id')
    res.render('categories', { categories: result.rows })
  } catch (err) {
    console.error(err)
    res.status(500).send('Database error')
  }
})

// Single category with its products
router.get('/:id', async (req, res) => {
  try {
    const catResult = await db.query('SELECT * FROM categories WHERE id = $1', [req.params.id])
    if (catResult.rows.length === 0) return res.status(404).render('404')

    const prodResult = await db.query(
      'SELECT * FROM products WHERE category_id = $1 ORDER BY id',
      [req.params.id]
    )

    res.render('category', {
      category: catResult.rows[0],
      products: prodResult.rows,
    })
  } catch (err) {
    console.error(err)
    res.status(500).send('Database error')
  }
})

module.exports = router
