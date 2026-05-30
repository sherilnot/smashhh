const express = require('express')
const router = express.Router()
const db = require('../db')

router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.*, c.name AS category_name, c.id AS category_id
       FROM products p
       JOIN categories c ON p.category_id = c.id
       WHERE p.id = $1`,
      [req.params.id]
    )
    if (result.rows.length === 0) return res.status(404).render('404')

    res.render('product', { product: result.rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).send('Database error')
  }
})

module.exports = router
